import { useMemo } from 'react'
import { CalendarDays, CheckCircle2, Clock3, Loader2, TrendingUp, Wallet } from 'lucide-react'
import {
  formatWeekStart, isCurrentWeek, type CourierDashboard
} from '../lib/staffStats'
import { formatDzd } from '../lib/format'
import RatingStars from './RatingStars'

type Props = {
  dashboard: CourierDashboard | null
  loading?: boolean
  error?: string
}

/**
 * Per-courier weekly panel: successful tasks, in-progress tasks, customer
 * confirmations, cancellations and earnings for each of the last weeks.
 * Weeks start on Monday, matching the database `date_trunc('week')`.
 */
export default function WeeklyStats({ dashboard, loading, error }: Props) {
  const weeks = dashboard?.weeks ?? []
  const peak = useMemo(
    () => Math.max(1, ...weeks.map(week => Math.max(week.successful, week.active))),
    [weeks]
  )
  const current = weeks.find(week => isCurrentWeek(week.weekStart)) ?? weeks[0] ?? null
  const totals = dashboard?.totals

  if (loading && !dashboard) {
    return (
      <div className="weekly-card">
        <div className="weekly-loading"><Loader2 size={18} className="spin" /> جارٍ حساب إحصائياتك…</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="weekly-card">
        <p className="weekly-error">{error}</p>
      </div>
    )
  }

  return (
    <div className="weekly-card">
      <header className="weekly-head">
        <div>
          <span className="eyebrow"><TrendingUp size={13} /> لوحة الأداء</span>
          <h3>مهامك الأسبوعية</h3>
        </div>
        <span className="weekly-rating">
          {dashboard?.ratingAvg != null ? (
            <>
              <RatingStars value={dashboard.ratingAvg} size={13} />
              <b>{dashboard.ratingAvg.toFixed(1)}</b>
              <small>{dashboard.ratingCount} تقييم</small>
            </>
          ) : (
            <small>لا تقييمات بعد</small>
          )}
        </span>
      </header>

      <div className="weekly-kpis">
        <div className="weekly-kpi ok">
          <span><CheckCircle2 size={14} /> هذا الأسبوع · ناجحة</span>
          <b>{current?.successful ?? 0}</b>
        </div>
        <div className="weekly-kpi run">
          <span><Clock3 size={14} /> هذا الأسبوع · قيد التنفيذ</span>
          <b>{current?.active ?? 0}</b>
        </div>
        <div className="weekly-kpi">
          <span><Wallet size={14} /> دخل الأسبوع</span>
          <b>{formatDzd(current?.earningsDzd ?? 0)}</b>
        </div>
      </div>

      {weeks.length > 0 && (
        <div className="weekly-chart" role="img" aria-label="مخطط المهام الأسبوعية">
          {[...weeks].reverse().map(week => (
            <div className={isCurrentWeek(week.weekStart) ? 'weekly-col current' : 'weekly-col'} key={week.weekStart}>
              <div className="weekly-bars">
                <span
                  className="bar ok"
                  style={{ height: `${Math.max(4, (week.successful / peak) * 100)}%` }}
                  title={`${week.successful} ناجحة`}
                />
                <span
                  className="bar run"
                  style={{ height: `${Math.max(4, (week.active / peak) * 100)}%` }}
                  title={`${week.active} قيد التنفيذ`}
                />
              </div>
              <span className="weekly-label">{formatWeekStart(week.weekStart)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="weekly-legend">
        <span><i className="dot ok" /> ناجحة</span>
        <span><i className="dot run" /> قيد التنفيذ</span>
        <span className="weekly-total"><CalendarDays size={12} /> الإجمالي: {totals?.delivered ?? 0} مسلَّم · {totals?.active ?? 0} جارٍ</span>
      </div>

      {weeks.length > 0 && (
        <ul className="weekly-list">
          {weeks.slice(0, 5).map(week => (
            <li key={week.weekStart}>
              <span className="weekly-week">{formatWeekStart(week.weekStart)}</span>
              <span className="weekly-nums">
                <b className="ok">{week.successful}</b> ناجحة
                <b className="run">{week.active}</b> جارٍ
                {week.cancelled > 0 && <><b className="off">{week.cancelled}</b> ملغاة</>}
              </span>
              <span className="weekly-earn">{formatDzd(week.earningsDzd)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
