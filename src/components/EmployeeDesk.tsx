import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft, Bike, CheckCircle2, Clock3, Loader2, MapPin, MessageCircle,
  Phone, RefreshCw, ShieldAlert, ShieldCheck, Star, Tag, UserRound, Wallet
} from 'lucide-react'
import type { Profile } from '../lib/auth'
import { loadCourierVerification } from '../lib/courierApply'
import { loadCourierStatus, setCourierAvailability, type CourierStatus } from '../lib/courierStatus'
import { serviceTitle } from '../lib/services'
import {
  advanceStaffOrder, canNegotiatePrice, claimStaffOrder, courierStep,
  isUnclaimedJob, loadStaffOrders, NEXT_STATUS, placeOffer,
  STATUS_ACTION_LABEL, type StaffOrder
} from '../lib/staffOrders'
import { courierConfirmDelivery } from '../lib/delivery'
import { loadCourierDashboard, type CourierDashboard } from '../lib/staffStats'
import { formatDzd, formatWhen } from '../lib/format'
import DeliveryScene from './DeliveryScene'
import OrderChat from './OrderChat'
import RatingStars from './RatingStars'
import WeeklyStats from './WeeklyStats'
import NotificationBell from './NotificationBell'
import type { LatLng } from '../lib/geo/config'

type Props = {
  profile: Profile
  onBack: () => void
  /** Order opened from a notification tap. */
  focusOrderId?: string | null
  onFocusHandled?: () => void
  /** Bumped by the notification watcher when a new order arrives. */
  refreshKey?: number
  unread?: number
  onUnreadChange?: (count: number) => void
  onOpenProfile?: () => void
  /** Notification tap inside the desk: focus that order. */
  onOpenOrder?: (orderId: string) => void
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'بانتظار موصّل',
  accepted: 'تم القبول',
  picked_up: 'تم الاستلام',
  in_transit: 'في الطريق',
  delivered: 'تم التسليم',
  cancelled: 'ملغي'
}

const toLocal = (e164: string) => e164.replace(/^\+213/, '0')

function pointOf(lat: number | null, lng: number | null): LatLng | null {
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return { lat, lng }
}

export default function EmployeeDesk({
  profile, onBack, focusOrderId, onFocusHandled, refreshKey = 0,
  unread = 0, onUnreadChange, onOpenProfile, onOpenOrder
}: Props) {
  const [orders, setOrders] = useState<StaffOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [permissionBlocked, setPermissionBlocked] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')
  const [courierVerified, setCourierVerified] = useState(profile.role !== 'courier')
  const [jobsRpcReady, setJobsRpcReady] = useState(false)
  const [listFilter, setListFilter] = useState<'open' | 'mine' | 'all'>('open')
  const [duty, setDuty] = useState<CourierStatus | null>(null)
  const [dutyBusy, setDutyBusy] = useState(false)
  const [dutyError, setDutyError] = useState('')
  const [offerInput, setOfferInput] = useState('')
  const [dashboard, setDashboard] = useState<CourierDashboard | null>(null)
  const [dashboardError, setDashboardError] = useState('')
  const [dashboardLoading, setDashboardLoading] = useState(false)
  const [chatOrder, setChatOrder] = useState<StaffOrder | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    setActionError('')
    const result = await loadStaffOrders()
    setLoading(false)
    if (!result.ok) {
      setPermissionBlocked(result.kind === 'permission')
      setError(result.error)
      setOrders([])
      return
    }
    setPermissionBlocked(false)
    setJobsRpcReady(result.source === 'jobs')
    if (profile.role === 'courier' && result.source === 'jobs') {
      setCourierVerified(result.verified)
    }
    setOrders(result.orders)
    setSelectedId(current => current && result.orders.some(order => order.id === current)
      ? current
      : result.orders[0]?.id ?? null)
  }, [profile.role])

  const refreshDashboard = useCallback(async () => {
    if (profile.role !== 'courier' && profile.role !== 'employee') return
    setDashboardLoading(true)
    setDashboardError('')
    const result = await loadCourierDashboard(profile.id)
    setDashboardLoading(false)
    if (!result.ok) {
      setDashboardError(result.error)
      return
    }
    setDashboard(result.dashboard)
  }, [profile.id, profile.role])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => { void refreshDashboard() }, [refreshDashboard])

  // A new order notification bumps refreshKey: pull the fresh list.
  useEffect(() => {
    if (refreshKey > 0) void refresh()
  }, [refreshKey, refresh])

  useEffect(() => {
    if (profile.role !== 'courier') {
      setCourierVerified(true)
      setDuty(null)
      return
    }
    let alive = true
    loadCourierVerification(profile.id).then(result => {
      if (alive) setCourierVerified(result.verified)
    })
    loadCourierStatus(profile.id).then(result => {
      if (!alive) return
      if (result.ok) setDuty(result.status)
      else setDutyError(result.error)
    })
    return () => { alive = false }
  }, [profile.id, profile.role])

  async function toggleDuty() {
    if (!duty || dutyBusy) return
    if (!duty.verified) {
      setDutyError('لا يمكن تفعيل الاستقبال قبل اعتماد حساب الموصّل.')
      return
    }
    const next = !duty.available
    setDutyBusy(true)
    setDutyError('')
    const result = await setCourierAvailability(profile.id, next)
    setDutyBusy(false)
    if (!result.ok) {
      setDutyError(result.error)
      return
    }
    setDuty(current => current ? { ...current, available: next } : current)
  }

  const canOperate = profile.role !== 'courier' || courierVerified

  const selected = useMemo(
    () => orders.find(order => order.id === selectedId) || null,
    [orders, selectedId]
  )

  const mine = orders.filter(order => order.courier_id === profile.id)
  const open = orders.filter(isUnclaimedJob)
  const selectedUnclaimed = selected ? isUnclaimedJob(selected) : false
  const visible = listFilter === 'open' ? open : listFilter === 'mine' ? mine : orders

  useEffect(() => {
    const pool = listFilter === 'open'
      ? orders.filter(isUnclaimedJob)
      : listFilter === 'mine'
        ? orders.filter(order => order.courier_id === profile.id)
        : orders
    setSelectedId(current => {
      if (!pool.length) return null
      if (current && pool.some(order => order.id === current)) return current
      return pool[0].id
    })
  }, [listFilter, orders, profile.id])

  // Deep link from a notification: jump to the tab that holds the order.
  useEffect(() => {
    if (!focusOrderId || !orders.length) return
    const target = orders.find(order => order.id === focusOrderId)
    if (!target) return
    setListFilter(target.courier_id === profile.id ? 'mine' : isUnclaimedJob(target) ? 'open' : 'all')
    setSelectedId(target.id)
    onFocusHandled?.()
  }, [focusOrderId, orders, profile.id, onFocusHandled])

  useEffect(() => {
    if (!selected) return
    setOfferInput(selected.price_dzd ? String(selected.price_dzd) : '')
  }, [selected?.id, selected?.price_dzd])

  async function runAction(order: StaffOrder, kind: 'claim' | 'advance' | 'confirm') {
    if (!canOperate) {
      setActionError('حساب الموصّل غير معتمد بعد. لا يمكن قبول الطلبات أو تحديث حالتها.')
      return
    }
    setBusyId(order.id)
    setActionError('')
    const result = kind === 'claim'
      ? await claimStaffOrder(order.id)
      : kind === 'confirm'
        ? await courierConfirmDelivery(order.id)
        : await advanceStaffOrder(order.id, NEXT_STATUS[order.status]!)
    setBusyId(null)
    if (!result.ok) {
      setActionError(result.error)
      return
    }
    await refresh()
    if (kind === 'confirm') void refreshDashboard()
  }

  async function submitOffer(event: React.FormEvent) {
    event.preventDefault()
    if (!selected) return
    const price = Number(offerInput)
    if (!Number.isFinite(price) || price < 100) {
      setActionError('أدخل سعراً بين 100 و500000 دج.')
      return
    }
    setBusyId(selected.id)
    setActionError('')
    const result = await placeOffer(selected.id, price)
    setBusyId(null)
    if (!result.ok) {
      setActionError(result.error)
      return
    }
    await refresh()
  }

  const pickup = selected ? pointOf(selected.pickup_lat, selected.pickup_lng) : null
  const dropoff = selected ? pointOf(selected.dropoff_lat, selected.dropoff_lng) : null
  const step = selected ? courierStep(selected, profile.id) : 'blocked'
  const negotiate = selected ? canNegotiatePrice(selected) : false

  return (
    <section className="desk-page desk-mobile">
      <header className="desk-top">
        <button className="ride-icon-btn" onClick={onBack} aria-label="رجوع"><ArrowLeft size={18} /></button>
        <div className="ride-brand">
          <img src="/brand/logo-mark.webp" alt="ERSEL" />
          <span>
            <b>ERSEL</b>
            <small>{profile.full_name || 'لوحة العمل'}</small>
          </span>
        </div>
        <div className="desk-top-actions">
          {onUnreadChange && (
            <NotificationBell
              unread={unread}
              onUnreadChange={onUnreadChange}
              onOpenOrder={orderId => {
                if (onOpenOrder) onOpenOrder(orderId)
                else {
                  const target = orders.find(order => order.id === orderId)
                  if (target) setSelectedId(target.id)
                }
              }}
            />
          )}
          {onOpenProfile && (
            <button className="ride-icon-btn" onClick={onOpenProfile} aria-label="الملف الشخصي">
              {profile.avatar_url
                ? <img className="ride-avatar" src={profile.avatar_url} alt="" />
                : <UserRound size={18} />}
            </button>
          )}
          <button className="ride-icon-btn" onClick={() => void refresh()} disabled={loading} aria-label="تحديث">
            {loading ? <Loader2 size={18} className="spin" /> : <RefreshCw size={18} />}
          </button>
        </div>
      </header>

      {profile.role === 'courier' && !courierVerified && (
        <div className="inline-alert warning" role="status">
          <ShieldAlert size={18} /> حسابك قيد المراجعة أو غير معتمد. لا يمكن قبول الطلبات من هذا الحساب.
        </div>
      )}

      {profile.role === 'courier' && duty && (
        <div className={duty.available ? 'duty-card on' : 'duty-card'}>
          <span className="duty-dot" />
          <div>
            <b>{duty.available ? 'متاح للعمل الآن' : 'غير متاح'}</b>
            <small>
              {duty.verified
                ? (duty.available ? 'حالتك ظاهرة للإدارة كموصّل جاهز.' : 'أوقف الاستقبال عندما لا تستطيع التوصيل.')
                : 'الحالة تبقى مغلقة حتى اعتماد حسابك.'}
            </small>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={duty.available}
            aria-label="حالة العمل"
            className={duty.available ? 'duty-switch on' : 'duty-switch'}
            disabled={dutyBusy || !duty.verified}
            onClick={() => void toggleDuty()}
          >
            <span />
          </button>
        </div>
      )}
      {dutyError && <div className="inline-alert danger" role="alert">{dutyError}</div>}

      <div className="desk-stats">
        <div><Clock3 size={16} /><span>متاحة</span><b>{open.length}</b></div>
        <div><Bike size={16} /><span>مسندة إليك</span><b>{mine.length}</b></div>
        <div><CheckCircle2 size={16} /><span>المعروضة</span><b>{orders.length}</b></div>
      </div>

      {(profile.role === 'courier' || profile.role === 'employee') && (
        <WeeklyStats dashboard={dashboard} loading={dashboardLoading} error={dashboardError} />
      )}

      <div className="desk-filters" role="tablist" aria-label="تصفية الطلبات">
        <button type="button" className={listFilter === 'open' ? 'on' : ''} onClick={() => setListFilter('open')}>متاحة ({open.length})</button>
        <button type="button" className={listFilter === 'mine' ? 'on' : ''} onClick={() => setListFilter('mine')}>طلباتي ({mine.length})</button>
        <button type="button" className={listFilter === 'all' ? 'on' : ''} onClick={() => setListFilter('all')}>الكل</button>
      </div>

      {permissionBlocked && (
        <div className="inline-alert warning" role="alert">
          <ShieldAlert size={18} /> {error} لم نتجاوز سياسات الأمان من الواجهة.
        </div>
      )}
      {error && !permissionBlocked && <div className="inline-alert danger" role="alert">{error}</div>}
      {actionError && <div className="inline-alert danger" role="alert">{actionError}</div>}

      {loading ? (
        <div className="empty-state">جارٍ تحميل الطلبات…</div>
      ) : !orders.length && !error ? (
        <div className="empty-state"><Bike size={34} /><b>لا توجد طلبات ظاهرة لحسابك</b><span>إما لا طلبات بعد، أو السياسة تقيّد العرض على ما أُسند إليك.</span></div>
      ) : visible.length === 0 ? (
        <div className="empty-state"><Bike size={34} /><b>لا طلبات في هذا التبويب</b><span>بدّل التصفية أو حدّث القائمة.</span></div>
      ) : (
        <div className="desk-layout">
          <div className="desk-list">
            {visible.map(order => (
              <button
                key={order.id}
                type="button"
                className={order.id === selectedId ? 'desk-item selected' : 'desk-item'}
                onClick={() => setSelectedId(order.id)}
              >
                <b>{serviceTitle(order.service)}</b>
                <span>{order.pickup} ← {order.dropoff}</span>
                <small>
                  <span className={`status status-${order.status}`}>{STATUS_LABELS[order.status]}</span>
                  {order.price_dzd ? ` · ${formatDzd(order.price_dzd)}` : ''}
                  {order.courier_id === profile.id ? ' · مسند إليك' : ''}
                  {order.unread_messages > 0 ? ` · ${order.unread_messages} رسالة` : ''}
                </small>
              </button>
            ))}
          </div>

          {selected && (
            <article className="desk-detail">
              <header>
                <span className={`status status-${selected.status}`}>{STATUS_LABELS[selected.status]}</span>
                <h2>{serviceTitle(selected.service)}</h2>
                {selected.order_code && <small className="muted">#{selected.order_code}</small>}
              </header>

              <dl className="summary-list">
                <div><dt><MapPin size={14} /> الاستلام</dt><dd>{selected.pickup}</dd></div>
                <div><dt><MapPin size={14} /> التسليم</dt><dd>{selected.dropoff}</dd></div>
                <div><dt><Wallet size={14} /> السعر</dt><dd>{selected.price_dzd ? formatDzd(selected.price_dzd) : 'غير محدد'}</dd></div>
                {selectedUnclaimed ? (
                  <div>
                    <dt><Phone size={14} /> التواصل</dt>
                    <dd>يظهر بعد قبول الطلب</dd>
                  </div>
                ) : (
                  <>
                    <div>
                      <dt><Phone size={14} /> التواصل</dt>
                      <dd dir="ltr">{selected.phone ? toLocal(selected.phone) : '—'}</dd>
                    </div>
                    {selected.customer_name && (
                      <div><dt><UserRound size={14} /> الاسم</dt><dd>{selected.customer_name}</dd></div>
                    )}
                    {selected.notes && <div><dt>ملاحظات</dt><dd>{selected.notes}</dd></div>}
                  </>
                )}
                {selected.details && <div><dt>التفاصيل</dt><dd>{selected.details}</dd></div>}
                {jobsRpcReady && selectedUnclaimed && (
                  <p className="field-hint">رقم الزبون واسمه يُعرضان بعد إسناد الطلب إليك.</p>
                )}
              </dl>

              {selected.courier_id === profile.id && (
                <div className="confirm-strip">
                  <span className={selected.courier_confirmed_at ? 'confirm-chip on' : 'confirm-chip'}>
                    <CheckCircle2 size={13} /> أنت {selected.courier_confirmed_at ? 'أكّدت التسليم' : 'لم تؤكّد بعد'}
                  </span>
                  <span className={selected.customer_confirmed_at ? 'confirm-chip on' : 'confirm-chip'}>
                    <ShieldCheck size={13} /> الزبون {selected.customer_confirmed_at ? 'أكّد الاستلام' : 'لم يؤكّد بعد'}
                  </span>
                  {selected.completed_at && <span className="confirm-chip done"><Star size={13} /> مكتمل</span>}
                </div>
              )}

              {selected.customer_rating != null && (
                <div className="courier-rating-note">
                  <Star size={14} /> تقييم الزبون: <RatingStars value={selected.customer_rating} size={12} />
                </div>
              )}

              {selectedUnclaimed && (
                <form className="offer-box" onSubmit={submitOffer}>
                  <label>
                    <span><Tag size={13} /> عرض سعر مختلف (اختياري)</span>
                    <div className="offer-row">
                      <input
                        type="number"
                        inputMode="numeric"
                        min={100}
                        max={500000}
                        step={10}
                        value={offerInput}
                        onChange={event => setOfferInput(event.target.value)}
                        placeholder="مثال: 300"
                      />
                      <button type="submit" className="secondary-button" disabled={busyId === selected.id}>
                        {busyId === selected.id ? <Loader2 size={14} className="spin" /> : <Tag size={14} />} إرسال العرض
                      </button>
                    </div>
                  </label>
                  <p className="field-hint">
                    {selected.my_offer != null
                      ? `عرضك الحالي: ${formatDzd(selected.my_offer)}. يمكنك تحديثه حتى يقبل الزبون عرضًا.`
                      : negotiate
                        ? 'اقترح سعرًا مختلفًا عن سعر الزبون. عند قبول الزبون لعرضك يُسند الطلب إليك فورًا.'
                        : 'الطلب أُسند بالفعل، لا يمكن تقديم عرض جديد.'}
                    {selected.offers_count > 0 ? ` · ${selected.offers_count} عرض قيد النظر` : ''}
                  </p>
                </form>
              )}

              <div className="desk-actions sticky-actions">
                {step === 'claim' && (
                  <button
                    className="primary-button full"
                    disabled={busyId === selected.id || !canOperate}
                    onClick={() => void runAction(selected, 'claim')}
                  >
                    {busyId === selected.id ? <Loader2 size={16} className="spin" /> : null}
                    قبول الطلب
                  </button>
                )}
                {step === 'advance' && STATUS_ACTION_LABEL[selected.status] && (
                  <button
                    className="primary-button full"
                    disabled={busyId === selected.id || !canOperate}
                    onClick={() => void runAction(selected, 'advance')}
                  >
                    {busyId === selected.id ? <Loader2 size={16} className="spin" /> : null}
                    {STATUS_ACTION_LABEL[selected.status]}
                  </button>
                )}
                {step === 'confirm' && (
                  <button
                    className="primary-button full"
                    disabled={busyId === selected.id || !canOperate}
                    onClick={() => void runAction(selected, 'confirm')}
                  >
                    {busyId === selected.id ? <Loader2 size={16} className="spin" /> : <ShieldCheck size={16} />}
                    تأكيد التسليم
                  </button>
                )}
                {step === 'done' && (
                  <p className="field-hint">
                    {selected.completed_at
                      ? 'الطلب مكتمل بتأكيد الطرفين.'
                      : 'أكّدت التسليم. بانتظار تأكيد الزبون لاستلام الطلب.'}
                  </p>
                )}
                {selected.courier_id === profile.id && (
                  <button
                    type="button"
                    className="secondary-button full"
                    onClick={() => setChatOrder(selected)}
                  >
                    <MessageCircle size={15} /> دردشة مع الزبون
                    {selected.unread_messages > 0 ? ` (${selected.unread_messages})` : ''}
                  </button>
                )}
              </div>

              {chatOrder && chatOrder.id === selected.id && (
                <OrderChat
                  orderId={chatOrder.id}
                  viewerId={profile.id}
                  title={chatOrder.customer_name || 'الزبون'}
                  subtitle={chatOrder.order_code ? `#${chatOrder.order_code}` : undefined}
                  avatarUrl={chatOrder.customer_avatar}
                  onClose={() => setChatOrder(null)}
                />
              )}

              <DeliveryScene
                pickup={pickup}
                dropoff={dropoff}
                liveAvailable={false}
                statusLabel={STATUS_LABELS[selected.status]}
              />
              {(!pickup || !dropoff) && (
                <p className="field-hint">لا توجد إحداثيات محفوظة لهذا الطلب، لذلك لا يُرسم مسار قيادة.</p>
              )}
              {selected.created_at && (
                <p className="field-hint">أُنشئ الطلب: {formatWhen(selected.created_at)}</p>
              )}
            </article>
          )}
        </div>
      )}
    </section>
  )
}
