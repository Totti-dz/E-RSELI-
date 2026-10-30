import { supabase } from './supabase'
import type { AppRole } from './auth'

export type AdminAccount = {
  id: string
  fullName: string
  phone: string
  role: AppRole
  createdAt: string
  courierVerified: boolean | null
}

export type AccountsResult =
  | { ok: true; accounts: AdminAccount[]; loaded: number; total: number | null; truncated: boolean }
  | { ok: false; error: string; kind: 'permission' | 'network' | 'other' }

export type OverviewStats = {
  customers: number | null
  employees: number | null
  couriers: number | null
  admins: number | null
  verifiedCouriers: number | null
  pendingApplications: number | null
  ordersActive: number | null
  ordersDelivered: number | null
  ordersCancelled: number | null
  source: 'rpc' | 'exact' | 'unavailable'
}

const ROLE_VALUES: AppRole[] = ['customer', 'courier', 'employee', 'admin']
const ACCOUNT_PAGE_SIZE = 300

function asRole(value: unknown): AppRole | null {
  return ROLE_VALUES.includes(value as AppRole) ? (value as AppRole) : null
}

function mapLoadError(message: string): AccountsResult {
  if (/permission|row-level security|42501|policy/i.test(message)) {
    return {
      ok: false,
      kind: 'permission',
      error: 'صلاحيات قاعدة البيانات لا تسمح بقراءة الحسابات لهذا الحساب.'
    }
  }
  if (/failed to fetch|network/i.test(message)) {
    return { ok: false, kind: 'network', error: 'تعذّر الاتصال بالشبكة.' }
  }
  return { ok: false, kind: 'other', error: 'تعذّر تحميل الحسابات: ' + message }
}

async function loadVerifiedMap(userIds: string[]): Promise<{ map: Map<string, boolean>; failed: boolean }> {
  const verifiedMap = new Map<string, boolean>()
  if (!supabase || userIds.length === 0) return { map: verifiedMap, failed: false }
  const chunkSize = 80
  let failed = false
  for (let i = 0; i < userIds.length; i += chunkSize) {
    const chunk = userIds.slice(i, i + chunkSize)
    const { data, error } = await supabase
      .from('courier_profiles')
      .select('user_id, is_verified')
      .in('user_id', chunk)
    if (error) {
      failed = true
      continue
    }
    for (const row of (data ?? []) as { user_id?: string; is_verified?: boolean }[]) {
      if (row.user_id) verifiedMap.set(row.user_id, Boolean(row.is_verified))
    }
  }
  return { map: verifiedMap, failed }
}

export async function loadAdminAccounts(): Promise<AccountsResult> {
  if (!supabase) return { ok: false, error: 'الاتصال بقاعدة البيانات غير مُعد.', kind: 'other' }

  const [{ data, error, count }, totalRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, full_name, phone, role, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .limit(ACCOUNT_PAGE_SIZE),
    supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
  ])

  if (error) return mapLoadError(error.message)

  const rows = (data ?? []) as Record<string, unknown>[]
  const ids = rows.map(row => String(row.id || '')).filter(Boolean)
  const verified = await loadVerifiedMap(ids)

  const accounts: AdminAccount[] = []
  for (const row of rows) {
    const role = asRole(row.role)
    const id = String(row.id || '')
    if (!role || !id) continue
    let courierVerified: boolean | null = null
    if (role === 'courier') {
      if (verified.map.has(id)) courierVerified = verified.map.get(id)!
      else if (!verified.failed) courierVerified = false
    }
    accounts.push({
      id,
      fullName: String(row.full_name || ''),
      phone: String(row.phone || ''),
      role,
      createdAt: String(row.created_at || ''),
      courierVerified
    })
  }

  const total = typeof totalRes.count === 'number' && !totalRes.error
    ? totalRes.count
    : (typeof count === 'number' ? count : null)

  return {
    ok: true,
    accounts,
    loaded: accounts.length,
    total,
    truncated: total != null ? accounts.length < total : accounts.length >= ACCOUNT_PAGE_SIZE
  }
}

async function countExact(table: string, column: string, value: string): Promise<number | null> {
  if (!supabase) return null
  const { count, error } = await supabase
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq(column, value)
  if (error) return null
  return typeof count === 'number' ? count : null
}

async function countOrdersIn(statuses: string[]): Promise<number | null> {
  if (!supabase) return null
  const { count, error } = await supabase
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .in('status', statuses)
  if (error) return null
  return typeof count === 'number' ? count : null
}

async function countVerifiedCouriers(): Promise<number | null> {
  if (!supabase) return null
  const { count, error } = await supabase
    .from('courier_profiles')
    .select('user_id', { count: 'exact', head: true })
    .eq('is_verified', true)
  if (error) return null
  return typeof count === 'number' ? count : null
}

const EMPTY_STATS: OverviewStats = {
  customers: null,
  employees: null,
  couriers: null,
  admins: null,
  verifiedCouriers: null,
  pendingApplications: null,
  ordersActive: null,
  ordersDelivered: null,
  ordersCancelled: null,
  source: 'unavailable'
}

function asCount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  return null
}

async function loadStatsFromExact(): Promise<OverviewStats> {
  const [
    customers, employees, couriers, admins,
    verifiedCouriers, pendingApplications,
    ordersActive, ordersDelivered, ordersCancelled
  ] = await Promise.all([
    countExact('profiles', 'role', 'customer'),
    countExact('profiles', 'role', 'employee'),
    countExact('profiles', 'role', 'courier'),
    countExact('profiles', 'role', 'admin'),
    countVerifiedCouriers(),
    countExact('courier_applications', 'status', 'pending'),
    countOrdersIn(['pending', 'accepted', 'picked_up', 'in_transit']),
    countExact('orders', 'status', 'delivered'),
    countExact('orders', 'status', 'cancelled')
  ])
  const any = [customers, employees, couriers, admins, verifiedCouriers, pendingApplications, ordersActive, ordersDelivered, ordersCancelled]
    .some(value => value != null)
  return {
    customers, employees, couriers, admins, verifiedCouriers, pendingApplications,
    ordersActive, ordersDelivered, ordersCancelled,
    source: any ? 'exact' : 'unavailable'
  }
}

export async function loadOverviewStats(): Promise<OverviewStats> {
  if (!supabase) return { ...EMPTY_STATS }

  const { data, error } = await supabase.rpc('admin_dashboard_stats')
  if (!error && data && typeof data === 'object') {
    const payload = data as Record<string, unknown>
    if (payload.ok === false) return loadStatsFromExact()
    const fromRpc: OverviewStats = {
      customers: asCount(payload.customers),
      employees: asCount(payload.employees),
      couriers: asCount(payload.couriers),
      admins: asCount(payload.admins),
      verifiedCouriers: asCount(payload.verified_couriers),
      pendingApplications: asCount(payload.pending_applications),
      ordersActive: asCount(payload.orders_active),
      ordersDelivered: asCount(payload.orders_delivered),
      ordersCancelled: asCount(payload.orders_cancelled),
      source: 'rpc'
    }
    if (fromRpc.admins == null) {
      fromRpc.admins = await countExact('profiles', 'role', 'admin')
    }
    return fromRpc
  }
  return loadStatsFromExact()
}
