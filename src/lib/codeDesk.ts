import { supabase } from './supabase'
import type { OrderStatus } from './staffOrders'
import type { AppRole } from './auth'

export type CodeDeskOrder = {
  id: string
  code: string
  service: string
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
  courier_name: string
  is_guest: boolean
  created_at: string
  updated_at: string | null
}

export type CodeDeskAccount = {
  id: string
  full_name: string
  phone: string
  role: AppRole
  created_at: string
  verified: boolean | null
  available: boolean | null
}

export type CodeDeskStats = {
  active: number
  delivered: number
  cancelled: number
  customers: number
  couriers: number
  verified_couriers: number
  available_couriers: number
  employees: number
  admins: number
}

export type CodeDeskPayload = {
  generatedAt: string
  stats: CodeDeskStats
  orders: CodeDeskOrder[]
  accounts: CodeDeskAccount[]
  ordersTruncated: boolean
  accountsTruncated: boolean
}

export type CodeDeskFailure =
  | 'weak_code'
  | 'invalid_code'
  | 'locked'
  | 'missing'
  | 'network'
  | 'other'

export type CodeDeskResult =
  | { ok: true; data: CodeDeskPayload }
  | { ok: false; kind: CodeDeskFailure; error: string }

export const CODE_DESK_ERRORS: Record<string, string> = {
  weak_code:
    "الرمز الحالي افتراضي أو قصير. غيّره أولًا في SQL Editor: select public.set_admin_code('ERSEL-2026-ADMIN'); ثم أعد المحاولة برمز من 10 محارف على الأقل.",
  invalid_code: 'رمز الإدارة غير صحيح.',
  locked: 'محاولات كثيرة خاطئة. انتظر 15 دقيقة ثم أعد المحاولة.'
}

function asNumber(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function asOrder(row: Record<string, unknown>): CodeDeskOrder {
  return {
    id: String(row.id || ''),
    code: String(row.code || ''),
    service: String(row.service || ''),
    status: (row.status as OrderStatus) || 'pending',
    customer_name: String(row.customer_name || ''),
    phone: String(row.phone || ''),
    pickup: String(row.pickup || ''),
    dropoff: String(row.dropoff || ''),
    details: String(row.details || ''),
    notes: String(row.notes || ''),
    price_dzd: asNumber(row.price_dzd),
    vehicle: row.vehicle === 'car' ? 'car' : 'motorcycle',
    courier_id: (row.courier_id as string) || null,
    courier_name: String(row.courier_name || ''),
    is_guest: Boolean(row.is_guest),
    created_at: String(row.created_at || ''),
    updated_at: row.updated_at ? String(row.updated_at) : null
  }
}

function asAccount(row: Record<string, unknown>): CodeDeskAccount | null {
  const role = row.role
  if (role !== 'customer' && role !== 'courier' && role !== 'employee' && role !== 'admin') return null
  return {
    id: String(row.id || ''),
    full_name: String(row.full_name || ''),
    phone: String(row.phone || ''),
    role,
    created_at: String(row.created_at || ''),
    verified: typeof row.verified === 'boolean' ? row.verified : null,
    available: typeof row.available === 'boolean' ? row.available : null
  }
}

/**
 * Read-only dashboard data, unlocked by the admin code alone.
 * The code never leaves memory: it is not written to localStorage or the URL.
 * Returns raw data only; nothing here can change an order or an account.
 */
export async function fetchCodeDesk(code: string): Promise<CodeDeskResult> {
  if (!supabase) {
    return {
      ok: false,
      kind: 'other',
      error: 'الاتصال بقاعدة البيانات غير مُعد. أضف مفاتيح Supabase إلى .env.local.'
    }
  }

  const { data, error } = await supabase.rpc('admin_code_view', { p_code: code })
  if (error) {
    const message = error.message || ''
    if (/schema cache|does not exist|PGRST202/i.test(message)) {
      return {
        ok: false,
        kind: 'missing',
        error: 'لوحة القراءة بالرمز غير مفعّلة على الخادم. شغّل ملف supabase/ersel_all_in_one.sql.'
      }
    }
    if (/failed to fetch|network/i.test(message)) {
      return { ok: false, kind: 'network', error: 'تعذّر الاتصال بالشبكة. تحقّق من الإنترنت.' }
    }
    return { ok: false, kind: 'other', error: 'تعذّر تحميل اللوحة: ' + message }
  }

  const payload = data as Record<string, unknown> | null
  if (!payload || payload.ok !== true) {
    const key = String(payload?.error || 'other')
    return {
      ok: false,
      kind: (['weak_code', 'invalid_code', 'locked'].includes(key) ? key : 'other') as CodeDeskFailure,
      error: CODE_DESK_ERRORS[key] || 'تعذّر فتح اللوحة.'
    }
  }

  const stats = (payload.stats || {}) as Record<string, unknown>
  const orders = Array.isArray(payload.orders) ? payload.orders : []
  const accounts = Array.isArray(payload.accounts) ? payload.accounts : []

  return {
    ok: true,
    data: {
      generatedAt: String(payload.generated_at || ''),
      stats: {
        active: asNumber(stats.active),
        delivered: asNumber(stats.delivered),
        cancelled: asNumber(stats.cancelled),
        customers: asNumber(stats.customers),
        couriers: asNumber(stats.couriers),
        verified_couriers: asNumber(stats.verified_couriers),
        available_couriers: asNumber(stats.available_couriers),
        employees: asNumber(stats.employees),
        admins: asNumber(stats.admins)
      },
      orders: (orders as Record<string, unknown>[]).map(asOrder),
      accounts: (accounts as Record<string, unknown>[])
        .map(asAccount)
        .filter((row): row is CodeDeskAccount => !!row),
      ordersTruncated: Boolean(payload.orders_truncated),
      accountsTruncated: Boolean(payload.accounts_truncated)
    }
  }
}
