import { supabase } from './supabase'
import type { ServiceId } from './services'

export type OrderStatus = 'pending' | 'accepted' | 'picked_up' | 'in_transit' | 'delivered' | 'cancelled'

export type StaffOrder = {
  id: string
  order_code: string
  service: ServiceId
  customer_name: string
  phone: string
  pickup: string
  dropoff: string
  details: string
  notes: string
  vehicle: 'motorcycle' | 'car'
  status: OrderStatus
  price_dzd: number
  courier_id: string | null
  customer_id: string | null
  pickup_lat: number | null
  pickup_lng: number | null
  dropoff_lat: number | null
  dropoff_lng: number | null
  created_at: string
  updated_at: string | null
  /** Set when the courier confirms handing the parcel over. */
  courier_confirmed_at: string | null
  /** Set when the customer confirms receiving it. */
  customer_confirmed_at: string | null
  /** Set automatically when both confirmations exist. */
  completed_at: string | null
  customer_avatar: string | null
  /** Stars the customer left on this order (courier view). */
  customer_rating: number | null
  /** This courier's latest price offer on the order, if any. */
  my_offer: number | null
  /** How many pending price offers the order has. */
  offers_count: number
  unread_messages: number
}

const SELECT_COLUMNS = [
  'id', 'service', 'customer_name', 'phone', 'pickup', 'dropoff', 'details',
  'vehicle', 'status', 'price_dzd', 'courier_id', 'customer_id', 'created_at', 'updated_at',
  'pickup_lat', 'pickup_lng', 'dropoff_lat', 'dropoff_lng', 'notes', 'order_code',
  'courier_confirmed_at', 'customer_confirmed_at', 'completed_at'
].join(',')

function numberOrNull(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function asOrder(row: Record<string, unknown>): StaffOrder {
  return {
    id: String(row.id),
    order_code: String(row.order_code || ''),
    service: row.service as ServiceId,
    customer_name: String(row.customer_name || ''),
    phone: String(row.phone || ''),
    pickup: String(row.pickup || ''),
    dropoff: String(row.dropoff || ''),
    details: String(row.details || ''),
    notes: String(row.notes || ''),
    vehicle: row.vehicle === 'car' ? 'car' : 'motorcycle',
    status: (row.status as OrderStatus) || 'pending',
    price_dzd: Number(row.price_dzd || 0),
    courier_id: (row.courier_id as string) || null,
    customer_id: (row.customer_id as string) || null,
    pickup_lat: row.pickup_lat == null ? null : Number(row.pickup_lat),
    pickup_lng: row.pickup_lng == null ? null : Number(row.pickup_lng),
    dropoff_lat: row.dropoff_lat == null ? null : Number(row.dropoff_lat),
    dropoff_lng: row.dropoff_lng == null ? null : Number(row.dropoff_lng),
    created_at: String(row.created_at || ''),
    updated_at: row.updated_at ? String(row.updated_at) : null,
    courier_confirmed_at: row.courier_confirmed_at ? String(row.courier_confirmed_at) : null,
    customer_confirmed_at: row.customer_confirmed_at ? String(row.customer_confirmed_at) : null,
    completed_at: row.completed_at ? String(row.completed_at) : null,
    customer_avatar: row.customer_avatar ? String(row.customer_avatar) : null,
    customer_rating: numberOrNull(row.customer_rating),
    my_offer: numberOrNull(row.my_offer),
    offers_count: Number(row.offers_count || 0),
    unread_messages: Number(row.unread_messages || 0)
  }
}

export type StaffLoadResult =
  | { ok: true; orders: StaffOrder[]; verified: boolean; source: 'jobs' | 'select' }
  | { ok: false; error: string; kind: 'permission' | 'network' | 'other' }

function isMissingRpc(message: string): boolean {
  return /schema cache|does not exist|PGRST202|PGRST205/i.test(message)
}

function parseJobRows(payload: unknown): Record<string, unknown>[] {
  if (!payload || typeof payload !== 'object') return []
  const orders = (payload as { orders?: unknown }).orders
  if (Array.isArray(orders)) return orders as Record<string, unknown>[]
  return []
}

async function loadStaffOrdersFromSelect(): Promise<StaffLoadResult> {
  if (!supabase) return { ok: false, error: 'الاتصال بقاعدة البيانات غير مُعد.', kind: 'other' }
  let { data, error } = await supabase
    .from('orders')
    .select(SELECT_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(80)

  // Older deployments may lack order_code / confirmation columns.
  if (error && /column .* does not exist|42703/i.test(error.message || '')) {
    const retry = await supabase
      .from('orders')
      .select('id,service,customer_name,phone,pickup,dropoff,details,vehicle,status,price_dzd,courier_id,customer_id,created_at,updated_at,pickup_lat,pickup_lng,dropoff_lat,dropoff_lng')
      .order('created_at', { ascending: false })
      .limit(80)
    data = (retry.data ?? null) as unknown as typeof data
    error = retry.error
  }

  if (error) {
    const message = error.message || ''
    if (error.code === '42501' || /permission|row-level security|policy/i.test(message)) {
      return {
        ok: false,
        kind: 'permission',
        error: 'صلاحيات قاعدة البيانات لا تسمح لهذا الحساب بقراءة الطلبات. يلزم تنفيذ سياسة الموظف المقترحة.'
      }
    }
    if (/failed to fetch|network/i.test(message)) {
      return { ok: false, kind: 'network', error: 'تعذّر الاتصال بالشبكة.' }
    }
    return { ok: false, kind: 'other', error: 'تعذّر تحميل الطلبات: ' + message }
  }
  const rows = (data ?? []) as unknown as Record<string, unknown>[]
  return { ok: true, orders: rows.map(asOrder), verified: true, source: 'select' }
}

export async function loadStaffOrders(): Promise<StaffLoadResult> {
  if (!supabase) return { ok: false, error: 'الاتصال بقاعدة البيانات غير مُعد.', kind: 'other' }

  const { data, error } = await supabase.rpc('staff_list_jobs')
  if (error) {
    const message = error.message || ''
    if (isMissingRpc(message)) return loadStaffOrdersFromSelect()
    const key = message.trim()
    if (key === 'not_authenticated' || key === 'not_staff') {
      return { ok: false, kind: 'permission', error: ACTION_ERRORS[key] }
    }
    if (error.code === '42501' || /permission|row-level security|policy/i.test(message)) {
      return {
        ok: false,
        kind: 'permission',
        error: 'صلاحيات قاعدة البيانات لا تسمح لهذا الحساب بقراءة الطلبات. يلزم تنفيذ سياسة الموظف المقترحة.'
      }
    }
    if (/failed to fetch|network/i.test(message)) {
      return { ok: false, kind: 'network', error: 'تعذّر الاتصال بالشبكة.' }
    }
    return { ok: false, kind: 'other', error: 'تعذّر تحميل الطلبات: ' + message }
  }

  const payload = data as { ok?: boolean; verified?: boolean } | null
  return {
    ok: true,
    orders: parseJobRows(data).map(asOrder),
    verified: payload?.verified !== false,
    source: 'jobs'
  }
}

export type ActionResult = { ok: true } | { ok: false; error: string }

const ACTION_ERRORS: Record<string, string> = {
  not_authenticated: 'سجّل الدخول أولاً.',
  not_staff: 'هذا الإجراء مخصّص للموظفين المعتمدين فقط.',
  not_verified: 'حساب الموصّل غير معتمد بعد. لا يمكن قبول الطلبات أو تحديث حالتها.',
  order_not_found: 'الطلب غير موجود أو لم يعد متاحاً.',
  already_taken: 'طلب آخر سبق أن قبله موظف.',
  not_assigned: 'هذا الطلب غير مسند إليك.',
  invalid_transition: 'لا يمكن تغيير الحالة بهذه الطريقة من الحالة الحالية.',
  permission_denied: 'الصلاحيات لا تسمح بهذا الإجراء.',
  price_invalid: 'أدخل سعراً بين 100 و500000 دج.',
  order_closed: 'الطلب لم يعد قابلاً للتفاوض (قُبل أو أُلغي).'
}

function mapRpcError(message: string): string {
  const key = (message || '').trim()
  if (ACTION_ERRORS[key]) return ACTION_ERRORS[key]
  if (isMissingRpc(message)) {
    return 'إجراءات الموظف غير مفعّلة على الخادم بعد. راجع ملف SQL المقترح.'
  }
  if (/row-level security|42501/i.test(message)) {
    return 'سياسة الوصول منعت التعديل. لم يُتجاوز الأمان من الواجهة.'
  }
  return 'تعذّر تنفيذ الإجراء: ' + message
}

export async function claimStaffOrder(orderId: string): Promise<ActionResult> {
  if (!supabase) return { ok: false, error: 'الاتصال بقاعدة البيانات غير مُعد.' }
  const { error } = await supabase.rpc('staff_claim_order', { p_order_id: orderId })
  if (error) return { ok: false, error: mapRpcError(error.message) }
  return { ok: true }
}

export async function advanceStaffOrder(orderId: string, next: OrderStatus): Promise<ActionResult> {
  if (!supabase) return { ok: false, error: 'الاتصال بقاعدة البيانات غير مُعد.' }
  const { error } = await supabase.rpc('staff_advance_order', { p_order_id: orderId, p_next: next })
  if (error) return { ok: false, error: mapRpcError(error.message) }
  return { ok: true }
}

/**
 * Price negotiation. A courier may propose a price while the order is still
 * unclaimed; the moment another courier accepts the order the server rejects
 * any new offer with `order_closed`, and the UI hides the control.
 */
export async function placeOffer(orderId: string, priceDzd: number): Promise<ActionResult> {
  if (!supabase) return { ok: false, error: 'الاتصال بقاعدة البيانات غير مُعد.' }
  if (!Number.isFinite(priceDzd) || priceDzd < 100) {
    return { ok: false, error: ACTION_ERRORS.price_invalid }
  }
  const { data, error } = await supabase.rpc('place_offer', {
    p_order_id: orderId,
    p_price: Math.round(priceDzd)
  })
  if (error) return { ok: false, error: mapRpcError(error.message) }
  const payload = data as { ok?: boolean; error?: string } | null
  if (!payload?.ok) {
    return { ok: false, error: ACTION_ERRORS[payload?.error || ''] || 'تعذّر إرسال عرض السعر.' }
  }
  return { ok: true }
}

export const NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus>> = {
  pending: 'accepted',
  accepted: 'picked_up',
  picked_up: 'in_transit',
  in_transit: 'delivered'
}

export const STATUS_ACTION_LABEL: Partial<Record<OrderStatus, string>> = {
  pending: 'قبول الطلب',
  accepted: 'تم الاستلام',
  picked_up: 'بدء التوصيل',
  in_transit: 'إتمام التسليم'
}

export function adminForwardStatuses(status: OrderStatus): OrderStatus[] {
  const next = NEXT_STATUS[status]
  return next ? [next] : []
}

export function canAdminCancel(status: OrderStatus): boolean {
  return status !== 'delivered' && status !== 'cancelled'
}

export function isUnclaimedJob(order: StaffOrder): boolean {
  return order.status === 'pending' && !order.courier_id
}

/** Price offers are only meaningful while nobody has accepted the order. */
export function canNegotiatePrice(order: StaffOrder): boolean {
  return isUnclaimedJob(order)
}

export type CourierStep = 'claim' | 'advance' | 'confirm' | 'done' | 'blocked'

/**
 * What the courier can do on this order right now.
 * `confirm` is the explicit delivery hand-over: it stamps the courier's
 * confirmation and moves the order to `delivered`.
 */
export function courierStep(order: StaffOrder, myId: string): CourierStep {
  if (isUnclaimedJob(order)) return 'claim'
  if (order.courier_id !== myId) return 'blocked'
  if (order.status === 'accepted') return 'advance'
  if (order.status === 'picked_up') return 'advance'
  if (order.status === 'in_transit') return 'confirm'
  if (order.status === 'delivered') return order.courier_confirmed_at ? 'done' : 'confirm'
  return 'blocked'
}
