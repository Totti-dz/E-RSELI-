import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, CheckCircle2, ClipboardList, Clock3, Loader2, MapPin,
  PackageCheck, Phone, Plus, RefreshCw, Search, Wallet, XCircle
} from 'lucide-react'
import {
  STATUS_HELP, STATUS_LABELS, STATUS_STEPS,
  canCustomerCancel, cancelMyOrder, loadMyOrders, type MyOrder
} from '../lib/myOrders'
import { serviceTitle } from '../lib/services'
import { formatDzd, formatWhen } from '../lib/format'

type Props = {
  onNewOrder: () => void
}

type Filter = 'all' | 'active' | 'done' | 'cancelled'

const ACTIVE_STATUSES = ['pending', 'accepted', 'picked_up', 'in_transit']

export default function MyOrders({ onNewOrder }: Props) {
  const [orders, setOrders] = useState<MyOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [schemaPartial, setSchemaPartial] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    const result = await loadMyOrders()
    setLoading(false)
    if (!result.ok) {
      setError(result.error)
      setOrders([])
      return
    }
    setSchemaPartial(result.schemaPartial)
    setOrders(result.orders)
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const counts = useMemo(() => ({
    all: orders.length,
    active: orders.filter(order => ACTIVE_STATUSES.includes(order.status)).length,
    done: orders.filter(order => order.status === 'delivered').length,
    cancelled: orders.filter(order => order.status === 'cancelled').length
  }), [orders])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return orders.filter(order => {
      if (filter === 'active' && !ACTIVE_STATUSES.includes(order.status)) return false
      if (filter === 'done' && order.status !== 'delivered') return false
      if (filter === 'cancelled' && order.status !== 'cancelled') return false
      if (!needle) return true
      return `${order.order_code} ${order.pickup} ${order.dropoff} ${order.details}`.toLowerCase().includes(needle)
    })
  }, [orders, filter, query])

  async function doCancel(order: MyOrder) {
    if (confirmId !== order.id) {
      setConfirmId(order.id)
      return
    }
    setBusyId(order.id)
    setError('')
    const result = await cancelMyOrder(order.id)
    setBusyId(null)
    setConfirmId(null)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setNotice('تم إلغاء الطلب. لا يمكن التراجع عن هذا الإجراء.')
    await refresh()
  }

  return (
    <section className="page-section">
      <div className="myorders-head">
        <div>
          <span className="eyebrow">متابعة</span>
          <h1 className="page-title">طلباتي</h1>
          <p className="muted">كل طلب محفوظ في حسابك مع حالته الحالية. تُقرأ الطلبات من قاعدة البيانات بسياسات تحمي بيانات الآخرين.</p>
        </div>
        <div className="myorders-actions">
          <button className="secondary-button" onClick={() => void refresh()} disabled={loading}>
            {loading ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />} تحديث
          </button>
          <button className="primary-button" onClick={onNewOrder}><Plus size={17} /> طلب جديد</button>
        </div>
      </div>

      {schemaPartial && (
        <div className="notice warning">قاعدة البيانات بنسخة أقدم: لا تحتوي رقم الطلب أو الملاحظات. شغّل ملف SQL الموحّد لتحديثها.</div>
      )}
      {error && <div className="inline-alert danger" role="alert">{error}</div>}
      {notice && (
        <div className="inline-alert success" role="status">
          <CheckCircle2 size={17} /> {notice}
          <button type="button" className="alert-dismiss" onClick={() => setNotice('')} aria-label="إغلاق">×</button>
        </div>
      )}

      <div className="cd-toolbar">
        <label className="cd-search">
          <Search size={16} />
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="ابحث برقم الطلب أو العنوان"
            type="search"
          />
        </label>
        <div className="cd-roles" role="tablist" aria-label="تصفية الطلبات">
          {([
            ['all', `الكل (${counts.all})`],
            ['active', `قيد التنفيذ (${counts.active})`],
            ['done', `مكتملة (${counts.done})`],
            ['cancelled', `ملغاة (${counts.cancelled})`]
          ] as const).map(([id, label]) => (
            <button key={id} type="button" className={filter === id ? 'on' : ''} onClick={() => setFilter(id)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="empty-state">جارٍ تحميل طلباتك…</div>
      ) : visible.length === 0 ? (
        <div className="empty-state">
          <ClipboardList size={34} />
          <b>{orders.length ? 'لا طلبات في هذه التصفية' : 'لا توجد طلبات بعد'}</b>
          <span>{orders.length ? 'بدّل التصفية أو امسح البحث.' : 'أنشئ أول طلب وستتابع حالته من هنا.'}</span>
          <button className="primary-button" onClick={onNewOrder}><Plus size={17} /> اطلب الآن</button>
        </div>
      ) : (
        <div className="myorders-list">
          {visible.map(order => {
            const stepIndex = STATUS_STEPS.indexOf(order.status)
            const isCancelled = order.status === 'cancelled'
            const isOpen = expanded === order.id
            const cancellable = canCustomerCancel(order.status)
            return (
              <article className={isOpen ? 'myorder open' : 'myorder'} key={order.id}>
                <header className="myorder-head">
                  <span className="myorder-icon"><PackageCheck size={19} /></span>
                  <div className="myorder-title">
                    <b>{serviceTitle(order.service)}</b>
                    <small>
                      {order.order_code ? `#${order.order_code} · ` : ''}
                      {formatWhen(order.created_at)}
                    </small>
                  </div>
                  <span className={`status status-${order.status}`}>{STATUS_LABELS[order.status]}</span>
                </header>

                <p className="myorder-route cd-route">
                  <span className="cd-place">
                    <MapPin size={14} /> {order.pickup || '—'}
                    <span className="cd-arrow">←</span>
                  </span>
                  <span className="cd-place">
                    <MapPin size={14} /> {order.dropoff || '—'}
                  </span>
                </p>

                <div className="myorder-meta">
                  <span><Wallet size={14} /> {order.price_dzd ? formatDzd(order.price_dzd) : 'السعر غير محدد'}</span>
                  <span><Clock3 size={14} /> {STATUS_HELP[order.status]}</span>
                </div>

                {isCancelled ? (
                  <p className="myorder-cancelled"><XCircle size={15} /> أُلغي هذا الطلب ولا يمكن إحياؤه. أنشئ طلبًا جديدًا عند الحاجة.</p>
                ) : (
                  <ol className="myorder-steps">
                    {STATUS_STEPS.map((step, index) => {
                      const state = index < stepIndex ? 'done' : index === stepIndex ? 'current' : 'idle'
                      return (
                        <li key={step} className={state}>
                          <span className="track-dot" />
                          <span>{STATUS_LABELS[step]}</span>
                        </li>
                      )
                    })}
                  </ol>
                )}

                {isOpen && (
                  <dl className="summary-list myorder-details">
                    {order.details && <div><dt>التفاصيل</dt><dd>{order.details}</dd></div>}
                    {order.notes && <div><dt>ملاحظات</dt><dd>{order.notes}</dd></div>}
                    <div><dt><Phone size={14} /> هاتف الطلب</dt><dd dir="ltr">{order.phone || '—'}</dd></div>
                    <div><dt>آخر تحديث</dt><dd>{formatWhen(order.updated_at || order.created_at)}</dd></div>
                  </dl>
                )}

                <footer className="myorder-foot">
                  <button type="button" className="text-button" onClick={() => setExpanded(isOpen ? null : order.id)}>
                    {isOpen ? 'إخفاء التفاصيل' : 'عرض التفاصيل'}
                  </button>
                  {cancellable && (
                    <button
                      type="button"
                      className={confirmId === order.id ? 'danger-button' : 'secondary-button danger-soft'}
                      onClick={() => void doCancel(order)}
                      disabled={busyId === order.id}
                    >
                      {busyId === order.id
                        ? <><Loader2 size={15} className="spin" /> جارٍ الإلغاء…</>
                        : confirmId === order.id
                          ? <><AlertTriangle size={15} /> تأكيد الإلغاء نهائيًا</>
                          : <><XCircle size={15} /> إلغاء الطلب</>}
                    </button>
                  )}
                </footer>
                {confirmId === order.id && (
                  <p className="field-hint">اضغط «تأكيد الإلغاء» مرة أخرى خلال هذه الشاشة. الإلغاء متاح فقط قبل استلام الموصّل للطلب.</p>
                )}
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
