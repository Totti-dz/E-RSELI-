import { supabase } from './supabase'
import { PENDING_SQL, isMissingRpc, isNetworkError, mapServerError } from './rpc'

/**
 * Text chat between the customer and the assigned courier.
 * One thread per order; the database hides it from everybody else.
 */

export type ChatMessage = {
  id: string
  orderId: string
  senderId: string
  senderRole: 'customer' | 'courier' | 'employee' | 'admin'
  body: string
  createdAt: string
  mine: boolean
}

export type ChatLoadResult =
  | { ok: true; messages: ChatMessage[] }
  | { ok: false; error: string }

const SEND_ERRORS: Record<string, string> = {
  not_authenticated: 'سجّل الدخول أولاً.',
  order_not_found: 'الطلب غير موجود.',
  not_participant: 'لا يمكنك مراسلة طرف آخر في هذا الطلب.',
  no_courier_yet: 'الدردشة تُفتح بعد قبول موصّل للطلب.',
  order_closed: 'الطلب ملغى، أُغلقت الدردشة.',
  empty_message: 'اكتب رسالة أولًا.',
  message_too_long: 'الرسالة طويلة جدًا (الحد 1000 حرف).'
}

const MAX_LENGTH = 1000

export async function loadOrderMessages(orderId: string, viewerId: string): Promise<ChatLoadResult> {
  if (!supabase) return { ok: false, error: 'الخدمة غير متاحة الآن.' }

  const { data, error } = await supabase
    .from('order_messages')
    .select('id,order_id,sender_id,sender_role,body,created_at')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true })
    .limit(200)

  if (error) {
    if (isMissingRpc(error.message)) return { ok: false, error: PENDING_SQL }
    if (isNetworkError(error.message)) return { ok: false, error: 'تعذّر الاتصال بالشبكة.' }
    if (error.code === '42501') return { ok: false, error: 'لا تملك صلاحية قراءة هذه الدردشة.' }
    return { ok: false, error: 'تعذّر تحميل الرسائل: ' + error.message }
  }

  const rows = (data ?? []) as unknown as Record<string, unknown>[]
  return {
    ok: true,
    messages: rows.map(row => ({
      id: String(row.id),
      orderId: String(row.order_id),
      senderId: String(row.sender_id),
      senderRole: (row.sender_role as ChatMessage['senderRole']) || 'customer',
      body: String(row.body || ''),
      createdAt: String(row.created_at || ''),
      mine: String(row.sender_id) === viewerId
    }))
  }
}

export async function sendOrderMessage(
  orderId: string,
  body: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!supabase) return { ok: false, error: 'الخدمة غير متاحة الآن.' }

  const trimmed = body.trim()
  if (!trimmed) return { ok: false, error: SEND_ERRORS.empty_message }
  if (trimmed.length > MAX_LENGTH) return { ok: false, error: SEND_ERRORS.message_too_long }

  const { data, error } = await supabase.rpc('send_order_message', {
    p_order_id: orderId,
    p_body: trimmed
  })
  if (error) {
    if (isMissingRpc(error.message)) return { ok: false, error: PENDING_SQL }
    if (isNetworkError(error.message)) return { ok: false, error: 'تعذّر الاتصال بالشبكة.' }
    return { ok: false, error: 'تعذّر إرسال الرسالة: ' + error.message }
  }

  const payload = data as { ok?: boolean; error?: string } | null
  if (!payload?.ok) {
    return { ok: false, error: mapServerError(payload?.error, SEND_ERRORS, 'تعذّر إرسال الرسالة.') }
  }
  return { ok: true }
}

/** Best-effort: a failure here must never break the chat UI. */
export async function markOrderMessagesRead(orderId: string): Promise<void> {
  if (!supabase) return
  try {
    await supabase.rpc('mark_order_messages_read', { p_order_id: orderId })
  } catch {
    /* read receipts are cosmetic */
  }
}

/** Live inserts for one order. Falls back to the caller's poller if Realtime is off. */
export function watchOrderMessages(orderId: string, onChange: () => void): () => void {
  if (!supabase) return () => {}
  const channel = supabase
    .channel(`ersel-chat-${orderId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'order_messages', filter: `order_id=eq.${orderId}` },
      () => onChange()
    )
    .subscribe()
  return () => { void supabase!.removeChannel(channel) }
}

export { MAX_LENGTH as CHAT_MAX_LENGTH }
