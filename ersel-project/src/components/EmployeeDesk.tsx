import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft, Bike, CheckCircle2, Clock3, Loader2, MapPin, Phone, RefreshCw, ShieldAlert, UserRound
} from 'lucide-react'
import type { Profile } from '../lib/auth'
import { loadCourierVerification } from '../lib/courierApply'
import { loadCourierStatus, setCourierAvailability, type CourierStatus } from '../lib/courierStatus'
import { serviceTitle } from '../lib/services'
import {
  advanceStaffOrder, claimStaffOrder, isUnclaimedJob, loadStaffOrders,
  NEXT_STATUS, STATUS_ACTION_LABEL, type StaffOrder
} from '../lib/staffOrders'
import DeliveryScene from './DeliveryScene'
import type { LatLng } from '../lib/geo/config'

type Props = {
  profile: Profile
  onBack: () => void
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'بانتظار موصّل',
  accepted: 'تم القبول',
  picked_up: 'تم الاستلام',
  in_transit: 'في الطريق',
  delivered: 'تم التسليم',
  cancelled: 'ملغي'
}

const formatDzd = (amount: number) => `${new Intl.NumberFormat('fr-DZ').format(amount)} دج`
const toLocal = (e164: string) => e164.replace(/^\+213/, '0')

function pointOf(lat: number | null, lng: number | null): LatLng | null {
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return { lat, lng }
}

export default function EmployeeDesk({ profile, onBack }: Props) {
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

  async function refresh() {
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
  }

  useEffect(() => { void refresh() }, [])

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

  async function runAction(order: StaffOrder, kind: 'claim' | 'advance') {
    if (!canOperate) {
      setActionError('حساب الموصّل غير معتمد بعد. لا يمكن قبول الطلبات أو تحديث حالتها.')
      return
    }
    setBusyId(order.id)
    setActionError('')
    const result = kind === 'claim'
      ? await claimStaffOrder(order.id)
      : await advanceStaffOrder(order.id, NEXT_STATUS[order.status]!)
    setBusyId(null)
    if (!result.ok) {
      setActionError(result.error)
      return
    }
    await refresh()
  }

  const pickup = selected ? pointOf(selected.pickup_lat, selected.pickup_lng) : null
  const dropoff = selected ? pointOf(selected.dropoff_lat, selected.dropoff_lng) : null

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
        <button className="ride-icon-btn" onClick={() => void refresh()} disabled={loading} aria-label="تحديث">
          {loading ? <Loader2 size={18} className="spin" /> : <RefreshCw size={18} />}
        </button>
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
                </small>
              </button>
            ))}
          </div>

          {selected && (
            <article className="desk-detail">
              <header>
                <span className={`status status-${selected.status}`}>{STATUS_LABELS[selected.status]}</span>
                <h2>{serviceTitle(selected.service)}</h2>
              </header>
              <dl className="summary-list">
                <div><dt><MapPin size={14} /> الاستلام</dt><dd>{selected.pickup}</dd></div>
                <div><dt><MapPin size={14} /> التسليم</dt><dd>{selected.dropoff}</dd></div>
                <div><dt>السعر</dt><dd>{selected.price_dzd ? formatDzd(selected.price_dzd) : 'غير محدد'}</dd></div>
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

              <div className="desk-actions sticky-actions">
                {selected.status === 'pending' && !selected.courier_id && (
                  <button
                    className="primary-button full"
                    disabled={busyId === selected.id || !canOperate}
                    onClick={() => void runAction(selected, 'claim')}
                  >
                    {busyId === selected.id ? <Loader2 size={16} className="spin" /> : null}
                    قبول الطلب
                  </button>
                )}
                {selected.courier_id === profile.id && STATUS_ACTION_LABEL[selected.status] && (
                  <button
                    className="primary-button full"
                    disabled={busyId === selected.id || !canOperate}
                    onClick={() => void runAction(selected, 'advance')}
                  >
                    {busyId === selected.id ? <Loader2 size={16} className="spin" /> : null}
                    {STATUS_ACTION_LABEL[selected.status]}
                  </button>
                )}
              </div>

              <DeliveryScene
                pickup={pickup}
                dropoff={dropoff}
                liveAvailable={false}
                statusLabel={STATUS_LABELS[selected.status]}
              />
              {(!pickup || !dropoff) && (
                <p className="field-hint">لا توجد إحداثيات محفوظة لهذا الطلب، لذلك لا يُرسم مسار قيادة.</p>
              )}
            </article>
          )}
        </div>
      )}
    </section>
  )
}
