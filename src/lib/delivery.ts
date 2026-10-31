import { supabase } from './supabase'
import { PENDING_SQL, isMissingRpc, isNetworkError, mapServerError } from './rpc'

/**
 * Delivery confirmation for both sides of an order.
 *
 * The courier confirming sets the order to `delivered` and stamps
 * `courier_confirmed_at`. The customer confirming stamps `customer_confirmed_at`.
 * Only when both stamps exist does the database set `completed_at` — that is the
 * "both parties agree the parcel arrived" state the UI shows as مكتمل.
 */

export type DeliveryConfirmation = {
  courierConfirmed: boolean
  customerConfirmed: boolean
  completed: boolean
}

export type ConfirmResult = ({ ok: true } & DeliveryConfirmation) | { ok: false; error: string }

const CONFIRM_ERRORS: Record<string, string> = {
  not_authenticated: 'سجّل الدخول أولاً.',
  order_not_found: 'الطلب غير موجود أو حُذف.',
  not_assigned: 'هذا الطلب غير مسند إليك.',
  not_owner: 'هذا الطلب ليس لك.',
  no_courier_yet: 'لم يُسند موصّل لهذا الطلب بعد.',
  order_closed: 'الطلب ملغى ولا يمكن تأكيد تسليمه.',
  invalid_transition: 'لا يمكن تأكيد التسليم من الحالة الحالية. حدّث الصفحة.'
}

function asConfirm(data: unknown): ConfirmResult {
  const payload = data as Record<string, unknown> | null
  if (!payload || payload.ok !== true) {
    return { ok: false, error: mapServerError(payload?.error as string, CONFIRM_ERRORS, 'تعذّر تأكيد التسليم.') }
  }
  return {
    ok: true,
    courierConfirmed: payload.courier_confirmed === true,
    customerConfirmed: payload.customer_confirmed === true,
    completed: payload.completed === true
  }
}

function toFailure(message: string, code?: string): ConfirmResult {
  if (isMissingRpc(message)) return { ok: false, error: PENDING_SQL }
  if (isNetworkError(message)) return { ok: false, error: 'تعذّر الاتصال بالشبكة. تحقّق من الإنترنت.' }
  if (code === '42501') return { ok: false, error: 'الصلاحيات لا تسمح بهذا الإجراء.' }
  return { ok: false, error: 'تعذّر تأكيد التسليم: ' + message }
}

export async function courierConfirmDelivery(orderId: string): Promise<ConfirmResult> {
  if (!supabase) return { ok: false, error: 'الخدمة غير متاحة الآن.' }
  const { data, error } = await supabase.rpc('courier_confirm_delivery', { p_order_id: orderId })
  if (error) return toFailure(error.message, error.code)
  return asConfirm(data)
}

export async function customerConfirmDelivery(orderId: string): Promise<ConfirmResult> {
  if (!supabase) return { ok: false, error: 'الخدمة غير متاحة الآن.' }
  const { data, error } = await supabase.rpc('customer_confirm_delivery', { p_order_id: orderId })
  if (error) return toFailure(error.message, error.code)
  return asConfirm(data)
}

/**
 * Guest receipt confirmation.
 *
 * A guest order has no account, so the only proof of ownership is the tracking
 * token the guest received when the order was created. The token is long and
 * random, and the server stores only its hash — an order number alone is never
 * enough to confirm anything.
 */
export async function guestConfirmDelivery(token: string): Promise<ConfirmResult> {
  if (!supabase) return { ok: false, error: 'الخدمة غير متاحة الآن.' }
  const trimmed = (token || '').trim()
  if (trimmed.length < 32) return { ok: false, error: 'رمز التتبع غير صالح.' }
  const { data, error } = await supabase.rpc('guest_confirm_delivery', { p_token: trimmed })
  if (error) {
    if (isMissingRpc(error.message)) {
      return { ok: false, error: 'تأكيد استلام طلبات الضيف غير مفعّل على الخادم. شغّل ملف SQL الموحّد.' }
    }
    if (isNetworkError(error.message)) return { ok: false, error: 'تعذّر الاتصال بالشبكة.' }
    return { ok: false, error: 'تعذّر تأكيد الاستلام: ' + error.message }
  }
  const payload = data as Record<string, unknown> | null
  if (!payload || payload.ok !== true) {
    const key = String(payload?.error || '')
    if (key === 'not_found') return { ok: false, error: 'رمز التتبع غير صحيح.' }
    if (key === 'no_courier_yet') return { ok: false, error: 'لم يُسند موصّل لهذا الطلب بعد.' }
    if (key === 'order_closed') return { ok: false, error: 'الطلب ملغى.' }
    return { ok: false, error: 'تعذّر تأكيد الاستلام.' }
  }
  return {
    ok: true,
    courierConfirmed: payload.courier_confirmed === true,
    customerConfirmed: payload.customer_confirmed === true,
    completed: payload.completed === true
  }
}

export type RateResult = { ok: true } | { ok: false; error: string }

const RATE_ERRORS: Record<string, string> = {
  not_authenticated: 'سجّل الدخول أولاً.',
  order_not_found: 'الطلب غير موجود.',
  not_owner: 'يمكنك تقييم طلباتك فقط.',
  no_courier: 'لم يُسند موصّل لهذا الطلب.',
  not_delivered: 'التقييم متاح بعد تسليم الطلب.',
  confirm_first: 'أكّد استلام الطلب أولًا ثم قيّم الموصّل.',
  stars_invalid: 'اختر عدد نجوم بين 1 و5.'
}

export async function rateCourier(orderId: string, stars: number, comment = ''): Promise<RateResult> {
  if (!supabase) return { ok: false, error: 'الخدمة غير متاحة الآن.' }
  const { data, error } = await supabase.rpc('rate_courier', {
    p_order_id: orderId,
    p_stars: Math.round(stars),
    p_comment: comment.trim()
  })
  if (error) {
    if (isMissingRpc(error.message)) return { ok: false, error: PENDING_SQL }
    if (isNetworkError(error.message)) return { ok: false, error: 'تعذّر الاتصال بالشبكة.' }
    return { ok: false, error: 'تعذّر إرسال التقييم: ' + error.message }
  }
  const payload = data as { ok?: boolean; error?: string } | null
  if (!payload?.ok) {
    return { ok: false, error: mapServerError(payload?.error, RATE_ERRORS, 'تعذّر إرسال التقييم.') }
  }
  return { ok: true }
}

/** The customer can confirm only once a courier is on the order and it is not cancelled. */
export function canCustomerConfirm(input: {
  status: string
  courierId: string | null
  customerConfirmed: boolean
}): boolean {
  if (input.customerConfirmed) return false
  if (!input.courierId) return false
  if (input.status === 'cancelled') return false
  return input.status === 'accepted' || input.status === 'picked_up' || input.status === 'in_transit' || input.status === 'delivered'
}

/** The courier confirms from the road, right before handing the parcel over. */
export function canCourierConfirm(input: { status: string; courierConfirmed: boolean }): boolean {
  if (input.courierConfirmed) return false
  return input.status === 'picked_up' || input.status === 'in_transit'
}

export function canRateOrder(input: {
  status: string
  customerConfirmed: boolean
  courierId: string | null
  alreadyRated: boolean
}): boolean {
  return input.status === 'delivered'
    && input.customerConfirmed
    && !!input.courierId
    && !input.alreadyRated
}
