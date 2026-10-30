import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft, Bike, CheckCircle2, ClipboardList, Clock3, Copy, Loader2, MapPin,
  Phone, RefreshCw, Search, ShieldCheck, UserRound, Users, Wallet, XCircle
} from 'lucide-react'
import {
  fetchCodeDesk,
  type CodeDeskAccount, type CodeDeskOrder, type CodeDeskPayload
} from '../lib/codeDesk'
import { ROLE_LABELS } from '../lib/roles'
import { serviceTitle } from '../lib/services'
import { formatDzd, formatWhen } from '../lib/format'

type Props = {
  code: string
  initial: CodeDeskPayload
  onExit: () => void
}

type Tab = 'active' | 'done' | 'cancelled' | 'accounts'

const ACTIVE_STATUSES = ['pending', 'accepted', 'picked_up', 'in_transit']

const STATUS_LABELS: Record<string, string> = {
  pending: 'بانتظار موصّل',
  accepted: 'تم القبول',
  picked_up: 'تم الاستلام',
  in_transit: 'في الطريق',
  delivered: 'تم التسليم',
  cancelled: 'ملغي'
}

const VEHICLE_LABELS: Record<string, string> = {
  motorcycle: 'دراجة',
  car: 'سيارة'
}

const toLocal = (value: string) => (value || '').replace(/^\+213/, '0')
const shortId = (id: string) => id.replace(/-/g, '').slice(0, 8)

function matches(order: CodeDeskOrder, needle: string): boolean {
  if (!needle) return true
  return `${order.code} ${order.customer_name} ${order.phone} ${order.pickup} ${order.dropoff} ${order.details} ${order.courier_name}`
    .toLowerCase()
    .includes(needle)
}

export default function CodeDesk({ code, initial, onExit }: Props) {
  const [data, setData] = useState<CodeDeskPayload>(initial)
  const [tab, setTab] = useState<Tab>('active')
  const [query, setQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<'all' | CodeDeskAccount['role']>('all')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    const result = await fetchCodeDesk(code)
    setLoading(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setData(result.data)
  }, [code])

  useEffect(() => {
    if (copied) {
      const timer = window.setTimeout(() => setCopied(''), 1600)
      return () => window.clearTimeout(timer)
    }
  }, [copied])

  const needle = query.trim().toLowerCase()

  const activeOrders = useMemo(
    () => data.orders.filter(order => ACTIVE_STATUSES.includes(order.status)),
    [data.orders]
  )
  const doneOrders = useMemo(
    () => data.orders.filter(order => order.status === 'delivered'),
    [data.orders]
  )
  const cancelledOrders = useMemo(
    () => data.orders.filter(order => order.status === 'cancelled'),
    [data.orders]
  )

  const visibleOrders = useMemo(() => {
    const source = tab === 'done' ? doneOrders : tab === 'cancelled' ? cancelledOrders : activeOrders
    return source.filter(order => matches(order, needle))
  }, [tab, activeOrders, doneOrders, cancelledOrders, needle])

  const visibleAccounts = useMemo(
    () => data.accounts.filter(account => {
      if (roleFilter !== 'all' && account.role !== roleFilter) return false
      if (!needle) return true
      return `${account.full_name} ${account.phone}`.toLowerCase().includes(needle)
    }),
    [data.accounts, roleFilter, needle]
  )

  async function copyPhone(phone: string) {
    const value = toLocal(phone)
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      setCopied(value)
    } catch {
      setCopied('')
      setError('تعذّر النسخ تلقائيًا. اضغط الرقم للاتصال مباشرة.')
    }
  }

  return (
    <section className="code-desk">
      <header className="code-desk-top">
        <button className="ride-icon-btn" onClick={onExit} aria-label="خروج"><ArrowLeft size={18} /></button>
        <div className="ride-brand">
          <img src="/brand/logo-mark.webp" alt="ERSEL" />
          <span>
            <b>لوحة الطلبات</b>
            <small>دخول بالرمز · قراءة فقط</small>
          </span>
        </div>
        <button className="ride-icon-btn" onClick={() => void refresh()} disabled={loading} aria-label="تحديث">
          {loading ? <Loader2 size={18} className="spin" /> : <RefreshCw size={18} />}
        </button>
      </header>

      <div className="cd-banner" role="status">
        <ShieldCheck size={17} />
        <span>
          عرض للقراءة فقط: لا يمكن من هنا قبول طلب أو تغيير حالة أو تعديل حساب.
          {data.generatedAt ? ` آخر تحديث ${formatWhen(data.generatedAt)}.` : ''}
        </span>
      </div>

      {error && <div className="inline-alert danger" role="alert">{error}</div>}

      <div className="cd-stats">
        <button type="button" className={tab === 'active' ? 'cd-stat on' : 'cd-stat'} onClick={() => setTab('active')}>
          <span className="cd-stat-label"><Clock3 size={15} /> قيد التنفيذ</span>
          <b>{data.stats.active}</b>
        </button>
        <button type="button" className={tab === 'done' ? 'cd-stat on' : 'cd-stat'} onClick={() => setTab('done')}>
          <span className="cd-stat-label"><CheckCircle2 size={15} /> مكتملة</span>
          <b>{data.stats.delivered}</b>
        </button>
        <button type="button" className={tab === 'cancelled' ? 'cd-stat on' : 'cd-stat'} onClick={() => setTab('cancelled')}>
          <span className="cd-stat-label"><XCircle size={15} /> ملغاة</span>
          <b>{data.stats.cancelled}</b>
        </button>
        <button type="button" className={tab === 'accounts' ? 'cd-stat on' : 'cd-stat'} onClick={() => setTab('accounts')}>
          <span className="cd-stat-label"><Users size={15} /> الحسابات</span>
          <b>{data.stats.customers + data.stats.couriers + data.stats.employees + data.stats.admins}</b>
        </button>
      </div>

      {tab !== 'accounts' && (
        <div className="cd-toolbar">
          <label className="cd-search">
            <Search size={16} />
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="ابحث برقم الطلب، الاسم، الهاتف أو العنوان"
              type="search"
            />
          </label>
        </div>
      )}

      {tab !== 'accounts' && (
        <>
          {data.ordersTruncated && (
            <p className="cd-hint">تُعرض أحدث 120 طلبًا فقط. افتح لوحة الإدارة الكاملة لسجل أقدم.</p>
          )}
          {loading && !data.orders.length && <div className="empty-state">جارٍ تحميل الطلبات…</div>}
          {!loading && visibleOrders.length === 0 && (
            <div className="empty-state">
              <ClipboardList size={32} />
              <b>لا طلبات في هذا التبويب</b>
              <span>{needle ? 'جرّب بحثًا آخر أو امسح خانة البحث.' : 'سيظهر هنا أي طلب جديد مباشرة بعد التحديث.'}</span>
            </div>
          )}
          <div className="cd-orders">
            {visibleOrders.map(order => (
              <article className="cd-order" key={order.id}>
                <header>
                  <span className={`status status-${order.status}`}>{STATUS_LABELS[order.status] || order.status}</span>
                  <b className="cd-code">#{order.code || shortId(order.id)}</b>
                  <span className="cd-time">{formatWhen(order.created_at)}</span>
                </header>

                <p className="cd-route">
                  <span className="cd-place">
                    <MapPin size={14} /> {order.pickup || '—'}
                    <span className="cd-arrow">←</span>
                  </span>
                  <span className="cd-place">
                    <MapPin size={14} /> {order.dropoff || '—'}
                  </span>
                </p>

                <div className="cd-meta">
                  <span><UserRound size={14} /> {order.customer_name || 'زبون'}{order.is_guest ? ' · ضيف' : ''}</span>
                  {order.phone ? (
                    <span className="cd-phone">
                      <a href={`tel:${order.phone}`} dir="ltr"><Phone size={14} /> {toLocal(order.phone)}</a>
                      <button type="button" onClick={() => void copyPhone(order.phone)} aria-label="نسخ الرقم">
                        {copied === toLocal(order.phone) ? <CheckCircle2 size={14} /> : <Copy size={14} />}
                      </button>
                    </span>
                  ) : (
                    <span><Phone size={14} /> —</span>
                  )}
                  <span><Wallet size={14} /> {order.price_dzd ? formatDzd(order.price_dzd) : 'غير محدد'}</span>
                  <span><Bike size={14} /> {order.courier_name || 'بلا موصّل'}</span>
                </div>

                {order.details && <p className="cd-note">التفاصيل: {order.details}</p>}
                {order.notes && <p className="cd-note">ملاحظات: {order.notes}</p>}

                <footer>
                  {serviceTitle(order.service)} · {VEHICLE_LABELS[order.vehicle] || order.vehicle}
                  {order.updated_at ? ` · آخر حركة ${formatWhen(order.updated_at)}` : ''}
                </footer>
              </article>
            ))}
          </div>
        </>
      )}

      {tab === 'accounts' && (
        <>
          <div className="cd-toolbar">
            <label className="cd-search">
              <Search size={16} />
              <input
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="ابحث بالاسم أو رقم الهاتف"
                type="search"
              />
            </label>
            <div className="cd-roles" role="tablist" aria-label="تصفية حسب الدور">
              {([
                ['all', 'الكل'],
                ['customer', 'زبائن'],
                ['courier', 'موصّلون'],
                ['employee', 'موظفون'],
                ['admin', 'مدراء']
              ] as const).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={roleFilter === id ? 'on' : ''}
                  onClick={() => setRoleFilter(id)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="cd-account-summary">
            <span>زبائن <b>{data.stats.customers}</b></span>
            <span>موصّلون <b>{data.stats.couriers}</b> · موثّق <b>{data.stats.verified_couriers}</b> · متاح الآن <b>{data.stats.available_couriers}</b></span>
            <span>موظفون <b>{data.stats.employees}</b></span>
            <span>مدراء <b>{data.stats.admins}</b></span>
          </div>

          {data.accountsTruncated && (
            <p className="cd-hint">تُعرض أحدث 200 حساب فقط.</p>
          )}
          {visibleAccounts.length === 0 ? (
            <div className="empty-state">
              <Users size={32} />
              <b>لا حسابات مطابقة</b>
              <span>غيّر التصفية أو امسح خانة البحث.</span>
            </div>
          ) : (
            <div className="cd-accounts">
              {visibleAccounts.map(account => (
                <article className="cd-account" key={account.id}>
                  <span className={`cd-role cd-role-${account.role}`}>{ROLE_LABELS[account.role]}</span>
                  <b>{account.full_name || 'بلا اسم'}</b>
                  <a href={`tel:${account.phone}`} dir="ltr"><Phone size={13} /> {toLocal(account.phone) || '—'}</a>
                  <span className="cd-time">سُجّل {formatWhen(account.created_at)}</span>
                  {account.role === 'courier' && (
                    <span className={account.verified ? 'cd-badge ok' : 'cd-badge warn'}>
                      {account.verified ? (account.available ? 'موثّق · متاح' : 'موثّق · غير متاح') : 'غير موثّق'}
                    </span>
                  )}
                </article>
              ))}
            </div>
          )}
        </>
      )}

      <p className="cd-foot">
        <ShieldCheck size={15} /> الرمز يُستخدم في الذاكرة فقط ولا يُخزَّن في المتصفح. أرقام الهواتف بيانات شخصية:
        لا تشارك هذه الشاشة أو صورها.
      </p>
    </section>
  )
}
