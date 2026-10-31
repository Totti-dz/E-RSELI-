import { supabase } from './supabase'
import { isMissingRpc, isNetworkError } from './rpc'
import type { OrderStatus } from './staffOrders'
import type { ServiceId } from './services'

export type PriceOffer = {
  id: string
  priceDzd: number
  createdAt: string
  courierName: string
  courierAvatar: string | null
  courierRating: number | null
  courierDelivered: number
}

export type MyRating = { stars: number; comment: string }

export type MyOrder = {
  id: string
  order_code: string
  service: ServiceId
  status: OrderStatus
  customer_name: string
  phone: string
  pickup: string
  dropoff: string
  details: string
  notes: string
  price_dzd: number
  vehicle: 'motorcycle' | 'car'
  courier_id: string | null
  created_at: string
  updated_at: string | null
  courier_confirmed_at: string | null
  customer_confirmed_at: string | null
  completed_at: string | null
  courier_name: string
  courier_avatar: string | null
  courier_phone: string
  courier_rating: number | null
  courier_rating_count: number
  my_rating: MyRating | null
  unread_messages: number
  offers: PriceOffer[]
}

const FALLBACK_COLUMNS = [
  'id', 'order_code', 'service', 'status', 'customer_name', 'phone',
  'pickup', 'dropoff', 'details', 'notes', 'price_dzd', 'vehicle',
  'courier_id', 'created_at', 'updated_at'
].join(',')

export type MyOrdersResult =
  | { ok: true; orders: MyOrder[]; schemaPartial: boolean }
  | { ok: false; error: string }

function numberOrNull(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function asOffer(row: Record<string, unknown>): PriceOffer {
  return {
    id: String(row.id),
    priceDzd: Number(row.price_dzd || 0),
    createdAt: String(row.created_at || ''),
    courierName: String(row.courier_name || ''),
    courierAvatar: row.courier_avatar ? String(row.courier_avatar) : null,
    courierRating: numberOrNull(row.courier_rating),
    courierDelivered: Number(row.courier_delivered || 0)
  }
}

function asOrder(row: Record<string, unknown>): MyOrder {
  const rating = row.my_rating as Record<string, unknown> | null | undefined
  const offers = Array.isArray(row.offers) ? (row.offers as Record<string, unknown>[]) : []
  return {
    id: String(row.id || ''),
    order_code: String(row.order_code || ''),
    service: row.service as ServiceId,
    status: (row.status as OrderStatus) || 'pending',
    customer_name: String(row.customer_name || ''),
    phone: String(row.phone || ''),
    pickup: String(row.pickup || ''),
    dropoff: String(row.dropoff || ''),
    details: String(row.details || ''),
    notes: String(row.notes || ''),
    price_dzd: Number(row.price_dzd || 0),
    vehicle: row.vehicle === 'car' ? 'car' : 'motorcycle',
    courier_id: (row.courier_id as string) || null,
    created_at: String(row.created_at || ''),
    updated_at: row.updated_at ? String(row.updated_at) : null,
    courier_confirmed_at: row.courier_confirmed_at ? String(row.courier_confirmed_at) : null,
    customer_confirmed_at: row.customer_confirmed_at ? String(row.customer_confirmed_at) : null,
    completed_at: row.completed_at ? String(row.completed_at) : null,
    courier_name: String(row.courier_name || ''),
    courier_avatar: row.courier_avatar ? String(row.courier_avatar) : null,
    courier_phone: String(row.courier_phone || ''),
    courier_rating: numberOrNull(row.courier_rating),
    courier_rating_count: Number(row.courier_rating_count || 0),
    my_rating: rating && typeof rating === 'object'
      ? { stars: Number(rating.stars || 0), comment: String(rating.comment || '') }
      : null,
    unread_messages: Number(row.unread_messages || 0),
    offers: offers.map(asOffer)
  }
}

/**
 * The signed-in customer's own orders.
 * `customer_my_orders` returns everything the screen needs in one call
 * (courier card, rating, offers, unread chat count). RLS already limits rows.
 */
export async function loadMyOrders(): Promise<MyOrdersResult> {
  if (!supabase) return { ok: false, error: 'الخدمة غير متاحة الآن. تواصل مع فريق ERSEL' }

  const rpc = await supabase.rpc('customer_my_orders')
  if (!rpc.error) {
    const payload = rpc.data as { ok?: boolean; orders?: unknown } | null
    if (payload?.ok) {
      const rows = Array.isArray(payload.orders) ? (payload.orders as Record<string, unknown>[]) : []
      return { ok: true, schemaPartial: false, orders: rows.map(asOrder) }
    }
  }

  // Fallback for deployments that have not run migration 14 yet.
  const rpcError = rpc.error?.message || ''
  const { data, error } = await supabase
    .from('orders')
    .select(FALLBACK_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(60)

  if (error) {
    const message = error.message || ''
    // Older deployments may not have order_code / notes yet: retry without them.
    if (/column .* does not exist|42703/i.test(message)) {
      const retry = await supabase
        .from('orders')
        .select('id,service,status,customer_name,phone,pickup,dropoff,details,price_dzd,vehicle,courier_id,created_at,updated_at')
        .order('created_at', { ascending: false })
        .limit(60)
      if (!retry.error) {
        return {
          ok: true,
          schemaPartial: true,
          orders: ((retry.data ?? []) as unknown as Record<string, unknown>[]).map(asOrder)
        }
      }
    }
    if (error.code === '42501' || /permission|row-level security|policy/i.test(message)) {
      return { ok: false, error: 'الصلاحيات لا تسمح بقراءة طلباتك. تحقّق من تسجيل الدخول.' }
    }
    if (isNetworkError(message)) {
      return { ok: false, error: 'تعذّر الاتصال بالشبكة.' }
    }
    return { ok: false, error: 'تعذّر تحميل الطلبات: ' + message }
  }

  return {
    ok: true,
    schemaPartial: !rpc.error || isMissingRpc(rpcError),
    orders: ((data ?? []) as unknown as Record<string, unknown>[]).map(asOrder)
  }
}

const CANCEL_ERRORS: Record<string, string> = {
  not_authenticated: 'سجّل الدخول أولاً.',
  order_not_found: 'الطلب غير موجود.',
  not_owner: 'هذا الطلب ليس لك.',
  invalid_transition: 'لا يمكن الإلغاء في هذه المرحلة. تواصل مع الدعم.',
  permission_denied: 'الصلاحيات لا تسمح بهذا الإجراء.'
}

export async function cancelMyOrder(orderId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!supabase) return { ok: false, error: 'الخدمة غير متاحة الآن. تواصل مع فريق ERSEL' }

  const { data, error } = await supabase.rpc('customer_cancel_order', { p_order_id: orderId })
  if (error) {
    if (/schema cache|does not exist|PGRST202/i.test(error.message)) {
      return { ok: false, error: 'إلغاء الطلب غير مفعّل على الخادم. شغّل ملف SQL الموحّد.' }
    }
    return { ok: false, error: CANCEL_ERRORS[error.message.trim()] || 'تعذّر إلغاء الطلب: ' + error.message }
  }
  const result = data as { ok?: boolean; error?: string } | null
  if (!result?.ok) {
    return { ok: false, error: CANCEL_ERRORS[result?.error || ''] || 'تعذّر إلغاء الطلب.' }
  }
  return { ok: true }
}

const OFFER_ERRORS: Record<string, string> = {
  not_authenticated: 'سجّل الدخول أولاً.',
  offer_not_found: 'العرض لم يعد موجودًا.',
  not_owner: 'هذا الطلب ليس لك.',
  order_closed: 'تم إسناد الطلب مسبقًا أو أُلغي.',
  permission_denied: 'الصلاحيات لا تسمح بهذا الإجراء.'
}

/** Accept one courier's price offer: assigns the order and fixes the final price. */
export async function acceptOffer(offerId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!supabase) return { ok: false, error: 'الخدمة غير متاحة الآن.' }
  const { data, error } = await supabase.rpc('accept_offer', { p_offer_id: offerId })
  if (error) {
    if (/schema cache|does not exist|PGRST202/i.test(error.message)) {
      return { ok: false, error: 'قبول العروض غير مفعّل على الخادم. شغّل ملف SQL الموحّد.' }
    }
    return { ok: false, error: 'تعذّر قبول العرض: ' + error.message }
  }
  const payload = data as { ok?: boolean; error?: string } | null
  if (!payload?.ok) {
    return { ok: false, error: OFFER_ERRORS[payload?.error || ''] || 'تعذّر قبول العرض.' }
  }
  return { ok: true }
}

/** Customer may cancel only before the courier picks the order up. */
export function canCustomerCancel(status: OrderStatus): boolean {
  return status === 'pending' || status === 'accepted'
}

export const STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'بانتظار موصّل',
  accepted: 'تم قبول الطلب',
  picked_up: 'تم الاستلام',
  in_transit: 'في الطريق',
  delivered: 'تم التسليم',
  cancelled: 'ملغي'
}

export const STATUS_STEPS: OrderStatus[] = ['pending', 'accepted', 'picked_up', 'in_transit', 'delivered']

export const STATUS_HELP: Record<OrderStatus, string> = {
  pending: 'طلبك مسجّل وينتظر قبول موصّل متاح.',
  accepted: 'تم قبول الطلب. يجري التنسيق للاستلام.',
  picked_up: 'استلم الموصّل الطلب من نقطة الانطلاق.',
  in_transit: 'الطلب في الطريق إلى نقطة الوصول.',
  delivered: 'أكّد استلامك ثم قيّم الموصّل.',
  cancelled: 'تم إلغاء الطلب. إن لم تتوقعه، تواصل مع ERSEL.'
}

/** Chat needs an assigned courier and a live order. */
export function canChat(order: Pick<MyOrder, 'courier_id' | 'status'>): boolean {
  return !!order.courier_id && order.status !== 'cancelled' && order.status !== 'pending'
}
