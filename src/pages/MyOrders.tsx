import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, CheckCircle2, ClipboardList, Clock3, Loader2, MapPin,
  MessageCircle, PackageCheck, Phone, Plus, RefreshCw, Search, ShieldCheck,
  Star, Wallet, XCircle
} from 'lucide-react'
import {
  STATUS_HELP, STATUS_LABELS, STATUS_STEPS, acceptOffer,
  canChat, canCustomerCancel, cancelMyOrder, loadMyOrders, type MyOrder
} from '../lib/myOrders'
import { customerConfirmDelivery, rateCourier } from '../lib/delivery'
import { serviceTitle } from '../lib/services'
import { formatDzd, formatWhen } from '../lib/format'
import OrderChat from '../components/OrderChat'
import RatingStars from '../components/RatingStars'

type Props = {
  onNewOrder: () => void
  viewerId?: string | null
  /** Order opened from a notification tap. */
  focusOrderId?: string | null
  onFocusHandled?: () => void
}

type Filter = 'all' | 'active' | 'done' | 'cancelled'

const ACTIVE_STATUSES = ['pending', 'accepted', 'picked_up', 'in_transit']

export default function MyOrders({ onNewOrder, viewerId, focusOrderId, onFocusHandled }: Props) {
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
  const [chatOrder, setChatOrder] = useState<MyOrder | null>(null)
  const [ratingOrder, setRatingOrder] = useState<MyOrder | null>(null)
  const [stars, setStars] = useState(5)
  const [comment, setComment] = useState('')
  const [ratingBusy, setRatingBusy] = useState(false)
  const [ratingError, setRatingError] = useState('')

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

  // Deep link from a notification: open that order and scroll it into view.
  useEffect(() => {
    if (!focusOrderId || !orders.length) return
    setFilter('all')
    setExpanded(focusOrderId)
    onFocusHandled?.()
  }, [focusOrderId, orders.length, onFocusHandled])

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

  async function doConfirmReceipt(order: MyOrder) {
    setBusyId(order.id)
    setError('')
    const result = await customerConfirmDelivery(order.id)
    setBusyId(null)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setNotice(result.completed
      ? 'تم تأكيد الاستلام من الطرفين. الطلب مكتمل الآن.'
      : 'تم تأكيد الاستلام. بانتظار تأكيد الموصّل إن لم يكن قد أكّد بعد.')
    await refresh()
    if (result.completed) {
      setRatingOrder({ ...order, customer_confirmed_at: new Date().toISOString() })
      setStars(5)
      setComment('')
      setRatingError('')
    }
  }

  async function doAcceptOffer(offerId: string) {
    setBusyId(offerId)
    setError('')
    const result = await acceptOffer(offerId)
    setBusyId(null)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setNotice('تم قبول العرض وإسناد الطلب للموصّل بالسعر المتفق عليه.')
    await refresh()
  }

  async function submitRating(event: React.FormEvent) {
    event.preventDefault()
    if (!ratingOrder) return
    setRatingBusy(true)
    setRatingError('')
    const result = await rateCourier(ratingOrder.id, stars, comment)
    setRatingBusy(false)
    if (!result.ok) {
      setRatingError(result.error)
      return
    }
    setRatingOrder(null)
    setNotice('شكرًا! تم تسجيل تقييمك للموصّل.')
    await refresh()
  }

  const chatOpenFor = chatOrder && viewerId ? chatOrder : null

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
            const needsMyConfirmation = !!order.courier_id
              && !order.customer_confirmed_at
              && order.status !== 'cancelled'
            const canRate = order.status === 'delivered'
              && !!order.customer_confirmed_at
              && !!order.courier_id
              && !order.my_rating
            const chatReady = canChat(order)
            const pendingOffers = order.offers.filter(offer => !order.courier_id)

            return (
              <article className={isOpen ? 'myorder open' : 'myorder'} key={order.id} id={`order-${order.id}`}>
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
                  {order.unread_messages > 0 && (
                    <span className="unread-pill"><MessageCircle size={13} /> {order.unread_messages} رسالة جديدة</span>
                  )}
                </div>

                {order.courier_id && (
                  <div className="courier-strip">
                    <span className="courier-avatar">
                      {order.courier_avatar
                        ? <img src={order.courier_avatar} alt="" />
                        : <span>{order.courier_name ? Array.from(order.courier_name)[0] : 'م'}</span>}
                    </span>
                    <div className="courier-copy">
                      <b>{order.courier_name || 'موصّل ERSEL'}</b>
                      <small>
                        {order.courier_rating != null
                          ? <><RatingStars value={order.courier_rating} size={11} /> {order.courier_rating.toFixed(1)} ({order.courier_rating_count})</>
                          : 'موصّل جديد'}
                      </small>
                    </div>
                    {chatReady && (
                      <button type="button" className="secondary-button small" onClick={() => setChatOrder(order)}>
                        <MessageCircle size={14} /> دردشة
                      </button>
                    )}
                  </div>
                )}

                {!isCancelled && (order.courier_confirmed_at || order.customer_confirmed_at) && (
                  <div className="confirm-strip">
                    <span className={order.courier_confirmed_at ? 'confirm-chip on' : 'confirm-chip'}>
                      <CheckCircle2 size={13} /> الموصّل {order.courier_confirmed_at ? 'أكّد التسليم' : 'لم يؤكّد بعد'}
                    </span>
                    <span className={order.customer_confirmed_at ? 'confirm-chip on' : 'confirm-chip'}>
                      <ShieldCheck size={13} /> أنت {order.customer_confirmed_at ? 'أكّدت الاستلام' : 'لم تؤكّد بعد'}
                    </span>
                    {order.completed_at && (
                      <span className="confirm-chip done"><Star size={13} /> مكتمل من الطرفين</span>
                    )}
                  </div>
                )}

                {pendingOffers.length > 0 && (
                  <div className="offers-box">
                    <b className="offers-title">عروض الأسعار الواردة ({pendingOffers.length})</b>
                    <ul>
                      {pendingOffers.map(offer => (
                        <li key={offer.id}>
                          <span className="offer-courier">
                            {offer.courierAvatar
                              ? <img src={offer.courierAvatar} alt="" />
                              : <span className="offer-initial">{offer.courierName ? Array.from(offer.courierName)[0] : 'م'}</span>}
                            <span>
                              <b>{offer.courierName || 'موصّل'}</b>
                              <small>
                                {offer.courierRating != null ? `★ ${offer.courierRating.toFixed(1)} · ` : ''}
                                {offer.courierDelivered} مهمة
                              </small>
                            </span>
                          </span>
                          <b className="offer-price">{formatDzd(offer.priceDzd)}</b>
                          <button
                            type="button"
                            className="primary-button small"
                            disabled={busyId === offer.id}
                            onClick={() => void doAcceptOffer(offer.id)}
                          >
                            {busyId === offer.id ? <Loader2 size={14} className="spin" /> : <CheckCircle2 size={14} />} قبول
                          </button>
                        </li>
                      ))}
                    </ul>
                    <p className="field-hint">قبول عرض يسند الطلب لذلك الموصّل ويثبّت السعر، وتُغلق بقية العروض تلقائيًا.</p>
                  </div>
                )}

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
                    {order.courier_phone && <div><dt><Phone size={14} /> هاتف الموصّل</dt><dd dir="ltr">{order.courier_phone}</dd></div>}
                    <div><dt>آخر تحديث</dt><dd>{formatWhen(order.updated_at || order.created_at)}</dd></div>
                    {order.my_rating && (
                      <div>
                        <dt>تقييمك</dt>
                        <dd><RatingStars value={order.my_rating.stars} size={12} /> {order.my_rating.comment || ''}</dd>
                      </div>
                    )}
                  </dl>
                )}

                {chatOpenFor && chatOpenFor.id === order.id && viewerId && (
                  <OrderChat
                    orderId={order.id}
                    viewerId={viewerId}
                    title={order.courier_name || 'الموصّل'}
                    subtitle={order.order_code ? `#${order.order_code}` : undefined}
                    avatarUrl={order.courier_avatar}
                    onClose={() => setChatOrder(null)}
                  />
                )}

                <footer className="myorder-foot">
                  <button type="button" className="text-button" onClick={() => setExpanded(isOpen ? null : order.id)}>
                    {isOpen ? 'إخفاء التفاصيل' : 'عرض التفاصيل'}
                  </button>
                  {needsMyConfirmation && (
                    <button
                      type="button"
                      className="primary-button small"
                      disabled={busyId === order.id}
                      onClick={() => void doConfirmReceipt(order)}
                    >
                      {busyId === order.id ? <Loader2 size={14} className="spin" /> : <ShieldCheck size={14} />} تأكيد استلام الطلب
                    </button>
                  )}
                  {canRate && (
                    <button
                      type="button"
                      className="secondary-button small"
                      onClick={() => { setRatingOrder(order); setStars(5); setComment(''); setRatingError('') }}
                    >
                      <Star size={14} /> تقييم الموصّل
                    </button>
                  )}
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

      {ratingOrder && (
        <div className="modal-layer" role="dialog" aria-modal="true" aria-label="تقييم الموصّل">
          <button type="button" className="modal-backdrop" aria-label="إغلاق" onClick={() => setRatingOrder(null)} />
          <form className="modal-card" onSubmit={submitRating}>
            <h3>كيف كانت تجربتك مع {ratingOrder.courier_name || 'الموصّل'}؟</h3>
            <p className="muted">تقييمك يساعد بقية الزبائن ويحسّن جودة الخدمة.</p>
            <div className="rating-picker">
              <RatingStars value={stars} onChange={setStars} size={30} />
            </div>
            <label className="field">
              <span>تعليق (اختياري)</span>
              <textarea
                value={comment}
                onChange={event => setComment(event.target.value)}
                maxLength={500}
                rows={3}
                placeholder="اكتب ملاحظة قصيرة عن التوصيل…"
              />
            </label>
            {ratingError && <p className="chat-error" role="alert">{ratingError}</p>}
            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={() => setRatingOrder(null)}>إلغاء</button>
              <button type="submit" className="primary-button" disabled={ratingBusy}>
                {ratingBusy ? <Loader2 size={15} className="spin" /> : <Star size={15} />} إرسال التقييم
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  )
}
