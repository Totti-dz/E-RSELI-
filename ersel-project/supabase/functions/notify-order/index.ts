// ============================================================
// ERSEL — إشعار FCM عند تغيّر حالة الطلب (اختياري)
//
// لماذا دالة Edge: مفتاح خدمة Firebase لا يجوز أن يدخل التطبيق أبدًا. هذه الدالة
// تحتفظ به في متغيرات البيئة وتُرسل الرسالة إلى رموز الأجهزة المسجّلة في
// public.device_tokens (القسم 13 من ملف SQL).
//
// التنصيب:
//   1) supabase functions deploy notify-order --no-verify-jwt
//   2) supabase secrets set FCM_SERVICE_ACCOUNT="$(cat service-account.json)"
//      (أو FCM_PROJECT_ID + FCM_CLIENT_EMAIL + FCM_PRIVATE_KEY منفصلة)
//   3) في Supabase → Database → Webhooks: أنشئ Webhook على جدول orders،
//      الحدث UPDATE، النوع HTTP Request، الهدف:
//        https://<PROJECT>.supabase.co/functions/v1/notify-order
//      مع ترويسة Authorization: Bearer <service_role>
//   4) أضف google-services.json إلى android/app/ وابنِ APK مع VITE_PUSH_ENABLED=true
//
// بدون هذه الخطوات يبقى التطبيق يعمل، وتصل الإشعارات المحلية فقط أثناء تشغيله.
// ============================================================

// @ts-expect-error — Deno runtime types are not part of the Vite project.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'

type OrderRow = {
  id: string
  order_code?: string
  user_id?: string | null
  status?: string
  pickup?: string
  dropoff?: string
  price_dzd?: number
}

const STATUS_TEXT: Record<string, string> = {
  accepted: 'تم قبول طلبك',
  picked_up: 'استلم الموصّل طلبك',
  in_transit: 'طلبك في الطريق',
  delivered: 'تم تسليم طلبك',
  cancelled: 'أُلغي الطلب'
}

function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function pemToPkcs8(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '')
  const raw = atob(body)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i)
  return bytes
}

/** OAuth2 access token for the FCM v1 API, signed with the service account key. */
async function fcmAccessToken(serviceAccount: { client_email: string; private_key: string }): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = base64url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })))
  const claim = base64url(new TextEncoder().encode(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  })))

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(serviceAccount.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(`${header}.${claim}`)
  )

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claim}.${base64url(new Uint8Array(signature))}`
    })
  })

  if (!response.ok) throw new Error(`token_exchange_failed: ${await response.text()}`)
  const payload = await response.json() as { access_token?: string }
  if (!payload.access_token) throw new Error('token_exchange_empty')
  return payload.access_token
}

async function tokensForUser(userId: string): Promise<string[]> {
  const url = Deno.env.get('SUPABASE_URL')!
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const response = await fetch(
    `${url}/rest/v1/device_tokens?user_id=eq.${encodeURIComponent(userId)}&select=token`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } }
  )
  if (!response.ok) return []
  const rows = await response.json() as { token: string }[]
  return rows.map(row => row.token).filter(Boolean)
}

serve(async (request: Request) => {
  if (request.method !== 'POST') return new Response('method_not_allowed', { status: 405 })

  const serviceAccountRaw = Deno.env.get('FCM_SERVICE_ACCOUNT')
  const projectId = Deno.env.get('FCM_PROJECT_ID')
  if (!serviceAccountRaw || !projectId) {
    return Response.json({ ok: false, error: 'fcm_not_configured' }, { status: 503 })
  }

  const serviceAccount = JSON.parse(serviceAccountRaw) as { client_email: string; private_key: string }
  const body = await request.json() as { record?: OrderRow; old_record?: OrderRow }
  const order = body.record
  const previous = body.old_record

  if (!order?.user_id) return Response.json({ ok: true, skipped: 'guest_order' })
  if (!order.status || order.status === previous?.status) return Response.json({ ok: true, skipped: 'no_change' })

  const tokens = await tokensForUser(order.user_id)
  if (tokens.length === 0) return Response.json({ ok: true, skipped: 'no_devices' })

  const accessToken = await fcmAccessToken(serviceAccount)
  const title = `طلب ${order.order_code ?? ''} · ${STATUS_TEXT[order.status] ?? order.status}`.trim()
  const route = [order.pickup, order.dropoff].filter(Boolean).join(' ← ')

  let sent = 0
  const failures: string[] = []

  for (const token of tokens) {
    const response = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          token,
          notification: { title, body: route },
          data: {
            orderId: order.id,
            orderCode: order.order_code ?? '',
            status: order.status,
            pickup: order.pickup ?? '',
            dropoff: order.dropoff ?? '',
            price: String(order.price_dzd ?? '')
          },
          android: {
            priority: 'HIGH',
            notification: {
              channel_id: 'ersel_orders',
              sound: 'ersel_chime',
              icon: 'ic_stat_ersel',
              color: '#0b1f45',
              default_vibrate_timings: true
            }
          }
        }
      })
    })

    if (response.ok) sent += 1
    else failures.push(await response.text())
  }

  return Response.json({ ok: sent > 0, sent, failed: failures.length, errors: failures.slice(0, 3) })
})
