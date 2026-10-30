import { supabase } from './supabase'
import type { OrderStatus } from './staffOrders'
import type { ServiceId } from './services'

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
}

const COLUMNS = [
  'id', 'order_code', 'service', 'status', 'customer_name', 'phone',
  'pickup', 'dropoff', 'details', 'notes', 'price_dzd', 'vehicle',
  'courier_id', 'created_at', 'updated_at'
].join(',')

export type MyOrdersResult =
  | { ok: true; orders: MyOrder[]; schemaPartial: boolean }
  | { ok: false; error: string }

function asOrder(row: Record<string, unknown>): MyOrder {
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
    updated_at: row.updated_at ? String(row.updated_at) : null
  }
}

/** The signed-in customer's own orders. RLS already limits the rows. */
export async function loadMyOrders(): Promise<MyOrdersResult> {
  if (!supabase) return { ok: false, error: 'الخدمة غير متاحة الآن. تواصل مع فريق ERSEL' }

  const { data, error } = await supabase
    .from('orders')
    .select(COLUMNS)
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
    if (/failed to fetch|network/i.test(message)) {
      return { ok: false, error: 'تعذّر الاتصال بالشبكة.' }
    }
    return { ok: false, error: 'تعذّر تحميل الطلبات: ' + message }
  }

  return {
    ok: true,
    schemaPartial: false,
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
  delivered: 'اكتملت عملية التوصيل.',
  cancelled: 'تم إلغاء الطلب. إن لم تتوقعه، تواصل مع ERSEL.'
}
