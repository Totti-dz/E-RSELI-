// ============================================================
// ERSEL — إشعار FCM عند حدث طلب أو رسالة (اختياري)
//
// لماذا دالة Edge: مفتاح خدمة Firebase لا يجوز أن يدخل التطبيق أبدًا.
// هذه الدالة تحتفظ به في أسرار Supabase وترسل إلى رموز public.device_tokens.
//
// التنصيب:
//   1) supabase functions deploy notify-order --no-verify-jwt
//   2) supabase secrets set FCM_SERVICE_ACCOUNT="$(cat service-account.json)"
//      FCM_PROJECT_ID="<firebase-project-id>"
//      NOTIFY_WEBHOOK_SECRET="<سلسلة طويلة عشوائية>"
//   3) Database → Webhooks (أو Database Webhooks على notifications):
//        POST https://<PROJECT>.supabase.co/functions/v1/notify-order
//        ترويسة: x-ersel-webhook-secret: <نفس السر>
//      الأحداث: INSERT على public.notifications
//   4) google-services.json في أسرار GitHub + VITE_PUSH_ENABLED=true
//
// بدون هذه الخطوات يبقى التطبيق يعمل، وتصل الإشعارات المحلية أثناء تشغيله.
// ============================================================

// @ts-expect-error — Deno runtime types are not part of the Vite project.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'

type NotificationRow = {
  id?: string
  user_id?: string | null
  kind?: string
  title?: string
  body?: string
  order_id?: string | null
}

type OrderRow = {
  id?: string
  order_code?: string
  customer_id?: string | null
  user_id?: string | null
  courier_id?: string | null
  status?: string
  pickup?: string
  dropoff?: string
  price_dzd?: number
}

const STATUS_TEXT: Record<string, string> = {
  accepted: 'تم قبول طلبك',
  picked_up: 'استلم الموصّل طلبك',
  in_transit: 'طلبك في الطريق',
  delivered: 'أكد الموصّل تسليم طلبك',
  cancelled: 'أُلغي الطلب'
}

function env(name: string): string {
  return (Deno.env.get(name) || '').trim()
}

function timingSafeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i += 1) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return mismatch === 0
}

function authorized(request: Request): boolean {
  const secret = env('NOTIFY_WEBHOOK_SECRET')
  if (!secret) return false
  const header = (request.headers.get('x-ersel-webhook-secret') || '').trim()
  if (timingSafeEqual(header, secret)) return true
  const auth = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  const service = env('SUPABASE_SERVICE_ROLE_KEY')
  return !!service && timingSafeEqual(auth, service)
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

async function rest<T>(path: string): Promise<T | null> {
  const url = env('SUPABASE_URL')
  const key = env('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return null
  const response = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }
  })
  if (!response.ok) return null
  return await response.json() as T
}

async function tokensForUser(userId: string): Promise<string[]> {
  const rows = await rest<{ token: string }[]>(
    `device_tokens?user_id=eq.${encodeURIComponent(userId)}&select=token`
  )
  return (rows || []).map(row => row.token).filter(Boolean)
}

async function tokensForStaff(): Promise<string[]> {
  const employees = await rest<{ id: string }[]>(`profiles?role=eq.employee&select=id`)
  const verified = await rest<{ user_id: string }[]>(
    `courier_profiles?is_verified=eq.true&select=user_id`
  )
  const ids = [
    ...(employees || []).map(row => row.id),
    ...(verified || []).map(row => row.user_id)
  ].filter(Boolean)
  if (!ids.length) return []
  const tokens = await rest<{ token: string }[]>(
    `device_tokens?user_id=in.(${ids.join(',')})&select=token`
  )
  return (tokens || []).map(row => row.token).filter(Boolean)
}

type PushPayload = {
  title: string
  body: string
  orderId: string
  kind: string
  status?: string
}

async function sendFcm(tokens: string[], payload: PushPayload): Promise<{ sent: number; failed: number }> {
  const serviceAccountRaw = env('FCM_SERVICE_ACCOUNT')
  const projectId = env('FCM_PROJECT_ID')
  // FCM device tokens only. Web Push subscriptions are JSON and cannot go
  // through messages:send with `token`. They stay in device_tokens for a
  // dedicated web-push sender if you add VAPID_PRIVATE_KEY later.
  const fcmTokens = tokens.filter(token => token && !token.startsWith('{'))
  if (!serviceAccountRaw || !projectId || fcmTokens.length === 0) return { sent: 0, failed: 0 }

  const serviceAccount = JSON.parse(serviceAccountRaw) as { client_email: string; private_key: string; project_id?: string }
  const accessToken = await fcmAccessToken(serviceAccount)
  const fcmProject = projectId || serviceAccount.project_id || ''
  let sent = 0
  let failed = 0

  for (const token of fcmTokens) {
    const response = await fetch(`https://fcm.googleapis.com/v1/projects/${fcmProject}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          token,
          notification: { title: payload.title, body: payload.body },
          data: {
            orderId: payload.orderId,
            kind: payload.kind,
            status: payload.status || '',
            title: payload.title,
            body: payload.body
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
          },
          webpush: {
            fcm_options: { link: payload.orderId ? `/?order=${payload.orderId}` : '/' },
            notification: {
              icon: '/brand/icon-192.png',
              badge: '/brand/icon-192.png',
              dir: 'rtl',
              lang: 'ar'
            }
          }
        }
      })
    })
    if (response.ok) sent += 1
    else failed += 1
  }
  return { sent, failed }
}

function fromNotification(row: NotificationRow): PushPayload | null {
  if (!row.user_id) return null
  return {
    title: row.title || 'ERSEL',
    body: row.body || '',
    orderId: row.order_id || '',
    kind: row.kind || 'system'
  }
}

function fromOrderChange(record: OrderRow, previous?: OrderRow): { userIds: string[]; payload: PushPayload } | null {
  const customerId = record.customer_id || record.user_id || null
  if (!record.status || record.status === previous?.status) return null
  const route = [record.pickup, record.dropoff].filter(Boolean).join(' ← ')
  const payload: PushPayload = {
    title: `طلب ${record.order_code ?? ''} · ${STATUS_TEXT[record.status] ?? record.status}`.trim(),
    body: route,
    orderId: record.id || '',
    kind: 'status',
    status: record.status
  }
  const userIds: string[] = []
  if (customerId) userIds.push(customerId)
  if (record.status === 'cancelled' && record.courier_id) userIds.push(record.courier_id)
  if (!userIds.length) return null
  return { userIds, payload }
}

serve(async (request: Request) => {
  if (request.method !== 'POST') return new Response('method_not_allowed', { status: 405 })
  if (!authorized(request)) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  if (!env('FCM_SERVICE_ACCOUNT') || !env('FCM_PROJECT_ID')) {
    return Response.json({ ok: false, error: 'fcm_not_configured' }, { status: 503 })
  }

  const body = await request.json() as {
    type?: string
    table?: string
    record?: NotificationRow & OrderRow
    old_record?: OrderRow
  }

  const table = (body.table || '').toLowerCase()
  const record = body.record || {}

  if (table === 'notifications' || record.kind) {
    const payload = fromNotification(record)
    if (!payload || !record.user_id) return Response.json({ ok: true, skipped: 'empty' })
    const tokens = await tokensForUser(record.user_id)
    if (!tokens.length) return Response.json({ ok: true, skipped: 'no_devices' })
    const result = await sendFcm(tokens, payload)
    return Response.json({ ok: result.sent > 0, ...result })
  }

  if (table === 'orders' || record.status) {
    const isInsert = (body.type || '').toLowerCase() === 'insert' || !body.old_record
    if (isInsert && (record.status === 'pending' || !record.status)) {
      const tokens = await tokensForStaff()
      if (!tokens.length) return Response.json({ ok: true, skipped: 'no_staff_devices' })
      const route = [record.pickup, record.dropoff].filter(Boolean).join(' ← ')
      const result = await sendFcm(tokens, {
        title: 'طلب جديد متاح الآن',
        body: [record.order_code, route, record.price_dzd ? `${record.price_dzd} دج` : '']
          .filter(Boolean)
          .join(' · '),
        orderId: record.id || '',
        kind: 'new_order',
        status: 'pending'
      })
      return Response.json({ ok: result.sent > 0, ...result })
    }

    const change = fromOrderChange(record, body.old_record)
    if (!change) return Response.json({ ok: true, skipped: 'no_change' })
    const tokens = (await Promise.all(change.userIds.map(tokensForUser))).flat()
    if (!tokens.length) return Response.json({ ok: true, skipped: 'no_devices' })
    const result = await sendFcm(tokens, change.payload)
    return Response.json({ ok: result.sent > 0, ...result })
  }

  return Response.json({ ok: true, skipped: 'unknown_payload' })
})
