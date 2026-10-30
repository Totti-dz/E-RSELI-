import { supabase } from './supabase'
import type { LatLng } from './geo/config'
import type { Place } from './geo/places'

export type ServiceId = 'food' | 'parcel' | 'shopping' | 'business'

export type OrderCapabilities = {
  /** orders has pickup/dropoff coordinates + area_id + is_guest. */
  coordinates: boolean
  /** orders has a free-text notes column. */
  notes: boolean
  /** create_guest_order / get_guest_order exist. */
  guestOrders: boolean
}

const UNKNOWN: OrderCapabilities = { coordinates: false, notes: false, guestOrders: false }

let capabilitiesPromise: Promise<OrderCapabilities> | null = null

async function hasColumns(columns: string): Promise<boolean> {
  if (!supabase) return false
  const { error } = await supabase.from('orders').select(columns).limit(1)
  return !error
}

/**
 * Read-only probe of the deployed schema. Never writes anything.
 * Cached for the lifetime of the page.
 */
export function getOrderCapabilities(): Promise<OrderCapabilities> {
  if (!supabase) return Promise.resolve(UNKNOWN)
  if (!capabilitiesPromise) {
    capabilitiesPromise = (async () => {
      const [coordinates, notes] = await Promise.all([
        hasColumns('pickup_lat,pickup_lng,dropoff_lat,dropoff_lng,area_id,is_guest'),
        hasColumns('notes')
      ])
      let guestOrders = false
      try {
        const { error } = await supabase.rpc('get_guest_order', { p_token: 'probe' })
        guestOrders = !error || !String(error.code || '').startsWith('PGRST2')
      } catch {
        guestOrders = false
      }
      return { coordinates, notes, guestOrders }
    })()
  }
  return capabilitiesPromise
}

export type OrderDraft = {
  service: ServiceId
  phoneE164: string
  customerName: string
  pickupText: string
  dropoffText: string
  pickup: LatLng
  dropoff: LatLng
  details: string
  notes: string
  vehicle: 'motorcycle' | 'car'
  priceDzd: number
}

export type SubmitResult =
  | { ok: true; kind: 'account'; orderId: string }
  | { ok: true; kind: 'guest'; orderId: string; orderCode: string; trackingToken: string }
  | { ok: false; error: string }

const GUEST_ERRORS: Record<string, string> = {
  phone_required: 'يرجى إدخال رقم الهاتف للتواصل.',
  phone_invalid: 'رقم الهاتف غير صحيح. استعمل رقماً جزائرياً مثل 0551234567.',
  service_invalid: 'نوع الخدمة غير صالح.',
  pickup_text_invalid: 'عنوان الانطلاق قصير جداً أو طويل جداً.',
  dropoff_text_invalid: 'عنوان الوصول قصير جداً أو طويل جداً.',
  details_too_long: 'وصف الطلب طويل جداً (الحد 1000 حرف).',
  coordinates_required: 'يجب تحديد نقطة الانطلاق والوصول على الخريطة.',
  coordinates_invalid: 'الإحداثيات المحددة غير صالحة.',
  outside_service_area: 'نقطة الانطلاق خارج نطاق الخدمة الحالي (بلدية السوقر).',
  dropoff_outside_service_area: 'نقطة الوصول خارج نطاق الخدمة الحالي (بلدية السوقر).',
  rate_limited_hour: 'طلبات كثيرة من نفس الرقم. انتظر ساعة ثم أعد المحاولة.',
  rate_limited_day: 'تم بلوغ الحد اليومي للطلبات من نفس الرقم. حاول غداً.',
  order_code_conflict: 'تعذّر توليد رقم طلب. أعد المحاولة.',
  not_configured: 'الطلب السريع غير مفعّل على الخادم بعد.',
  orders_min_price: 'أقل سعر للتوصيل هو 100 دج.'
}

function mapGuestError(message: string): string {
  const key = (message || '').trim()
  if (GUEST_ERRORS[key]) return GUEST_ERRORS[key]
  if (/orders_min_price/.test(message)) return GUEST_ERRORS.orders_min_price
  if (/function .* does not exist|schema cache/i.test(message)) {
    return 'الطلب السريع للضيف غير مفعّل على الخادم بعد. سجّل الدخول لإرسال الطلب حالياً.'
  }
  return 'تعذّر حفظ الطلب: ' + message
}

export async function submitGuestOrder(draft: OrderDraft): Promise<SubmitResult> {
  if (!supabase) return { ok: false, error: 'الخدمة غير متاحة الآن. تواصل مع فريق ERSEL' }
  const { data, error } = await supabase.rpc('create_guest_order', {
    payload: {
      phone: draft.phoneE164,
      service: draft.service,
      pickup_text: draft.pickupText,
      dropoff_text: draft.dropoffText,
      details: draft.details,
      notes: draft.notes,
      price_dzd: draft.priceDzd,
      pickup_lat: draft.pickup.lat,
      pickup_lng: draft.pickup.lng,
      dropoff_lat: draft.dropoff.lat,
      dropoff_lng: draft.dropoff.lng
    }
  })
  if (error) return { ok: false, error: mapGuestError(error.message) }
  const result = data as { ok?: boolean; order_id?: string; order_code?: string; tracking_token?: string; error?: string } | null
  if (!result?.ok || !result.order_id || !result.tracking_token) {
    return { ok: false, error: mapGuestError(result?.error || 'unknown') }
  }
  return {
    ok: true,
    kind: 'guest',
    orderId: result.order_id,
    orderCode: result.order_code || '',
    trackingToken: result.tracking_token
  }
}

export async function submitAccountOrder(draft: OrderDraft, userId: string): Promise<SubmitResult> {
  if (!supabase) return { ok: false, error: 'الخدمة غير متاحة الآن. تواصل مع فريق ERSEL' }
  const capabilities = await getOrderCapabilities()

  const payload: Record<string, unknown> = {
    customer_id: userId,
    service: draft.service,
    customer_name: draft.customerName.trim() || 'زبون',
    phone: draft.phoneE164,
    pickup: draft.pickupText,
    dropoff: draft.dropoffText,
    details: draft.details,
    vehicle: draft.vehicle,
    status: 'pending',
    price_dzd: draft.priceDzd,
    city: 'السوقر'
  }
  if (capabilities.coordinates) {
    payload.pickup_lat = draft.pickup.lat
    payload.pickup_lng = draft.pickup.lng
    payload.dropoff_lat = draft.dropoff.lat
    payload.dropoff_lng = draft.dropoff.lng
  }
  if (capabilities.notes) payload.notes = draft.notes

  const { data, error } = await supabase.from('orders').insert(payload).select('id').single()
  if (error) {
    if (String(error.code) === '42501') {
      return { ok: false, error: 'الصلاحيات لا تسمح بحفظ الطلب لهذا الحساب. تحقّق من تسجيل الدخول أو تواصل مع الدعم.' }
    }
    return { ok: false, error: 'لم يُحفظ الطلب: ' + error.message }
  }
  return { ok: true, kind: 'account', orderId: (data as { id: string }).id }
}

export type GuestTrackResult =
  | { ok: true; orderCode: string; service: string; status: string; createdAt: string }
  | { ok: false; error: string }

export async function trackGuestOrder(token: string): Promise<GuestTrackResult> {
  if (!supabase) return { ok: false, error: 'الخدمة غير متاحة الآن. تواصل مع فريق ERSEL' }
  const trimmed = token.trim()
  if (trimmed.length < 32) return { ok: false, error: 'رمز التتبع غير صالح.' }
  const { data, error } = await supabase.rpc('get_guest_order', { p_token: trimmed })
  if (error) {
    if (/schema cache|does not exist/i.test(error.message)) {
      return { ok: false, error: 'تتبع طلبات الضيف غير مفعّل على الخادم بعد.' }
    }
    return { ok: false, error: 'تعذّر جلب حالة الطلب.' }
  }
  const result = data as { ok?: boolean; order_code?: string; service?: string; status?: string; created_at?: string; error?: string } | null
  if (!result?.ok) return { ok: false, error: 'لم نجد طلباً بهذا الرمز.' }
  return {
    ok: true,
    orderCode: result.order_code || '',
    service: result.service || '',
    status: result.status || 'pending',
    createdAt: result.created_at || ''
  }
}

export function isInsideArea(point: LatLng, center: LatLng, radiusM: number): boolean {
  const R = 6371000
  const toRad = (v: number) => (v * Math.PI) / 180
  const dLat = toRad(point.lat - center.lat)
  const dLng = toRad(point.lng - center.lng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(center.lat)) * Math.cos(toRad(point.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h))) <= radiusM
}

export type { Place }
