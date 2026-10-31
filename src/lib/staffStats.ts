import { supabase } from './supabase'
import { PENDING_SQL, isMissingRpc, isNetworkError, mapServerError } from './rpc'

/**
 * Per-courier weekly performance.
 *
 * `successful` = orders delivered that week, `active` = still in progress,
 * `confirmed` = the customer also confirmed receipt, `cancelled` = cancelled.
 * Weeks start on Monday (PostgreSQL `date_trunc('week')`).
 */

export type WeekStat = {
  weekStart: string
  successful: number
  active: number
  confirmed: number
  cancelled: number
  earningsDzd: number
}

export type CourierDashboard = {
  userId: string
  ratingAvg: number | null
  ratingCount: number
  totals: {
    delivered: number
    completed: number
    active: number
    offers: number
  }
  weeks: WeekStat[]
}

export type DashboardResult =
  | { ok: true; dashboard: CourierDashboard }
  | { ok: false; error: string }

const DASH_ERRORS: Record<string, string> = {
  not_authenticated: 'سجّل الدخول أولاً.',
  permission_denied: 'لا تملك صلاحية قراءة لوحة موظف آخر.'
}

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

export async function loadCourierDashboard(
  userId?: string | null,
  weeks = 8
): Promise<DashboardResult> {
  if (!supabase) return { ok: false, error: 'الخدمة غير متاحة الآن.' }

  const { data, error } = await supabase.rpc('courier_dashboard', {
    p_user: userId ?? null,
    p_weeks: weeks
  })

  if (error) {
    if (isMissingRpc(error.message)) return { ok: false, error: PENDING_SQL }
    if (isNetworkError(error.message)) return { ok: false, error: 'تعذّر الاتصال بالشبكة.' }
    return { ok: false, error: 'تعذّر تحميل لوحة الإحصائيات: ' + error.message }
  }

  const payload = data as Record<string, unknown> | null
  if (!payload || payload.ok !== true) {
    return { ok: false, error: mapServerError(payload?.error as string, DASH_ERRORS, 'تعذّر تحميل اللوحة.') }
  }

  const totals = (payload.totals ?? {}) as Record<string, unknown>
  const rawWeeks = Array.isArray(payload.weeks) ? payload.weeks as Record<string, unknown>[] : []

  return {
    ok: true,
    dashboard: {
      userId: String(payload.user_id || userId || ''),
      ratingAvg: payload.rating_avg == null ? null : num(payload.rating_avg),
      ratingCount: num(payload.rating_count),
      totals: {
        delivered: num(totals.delivered),
        completed: num(totals.completed),
        active: num(totals.active),
        offers: num(totals.offers)
      },
      weeks: rawWeeks.map(row => ({
        weekStart: String(row.week_start || ''),
        successful: num(row.successful),
        active: num(row.active),
        confirmed: num(row.confirmed),
        cancelled: num(row.cancelled),
        earningsDzd: num(row.earnings_dzd)
      }))
    }
  }
}

const AR_MONTHS = [
  'جانفي', 'فيفري', 'مارس', 'أفريل', 'ماي', 'جوان',
  'جويلية', 'أوت', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
]

/** `2026-10-26` → `26 أكتوبر`. Direction-neutral so it reads fine inside RTL. */
export function formatWeekStart(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '')
  if (!match) return value || '—'
  const month = Number(match[2]) - 1
  return `${Number(match[3])} ${AR_MONTHS[month] ?? ''}`.trim()
}

/** True when the bucket is the current week. */
export function isCurrentWeek(weekStart: string, now = new Date()): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(weekStart || '')
  if (!match) return false
  const start = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  // Monday-based week, matching date_trunc('week').
  const offset = (today.getDay() + 6) % 7
  const monday = new Date(today)
  monday.setDate(today.getDate() - offset)
  return start.getTime() === monday.getTime()
}
