import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowLeft, Camera, CheckCircle2, Clock3, Loader2, LogOut, Phone,
  RefreshCw, ShieldCheck, Star, Trash2, UserRound
} from 'lucide-react'
import type { Profile as Account } from '../lib/auth'
import { avatarInitials, updateMyProfile, uploadAvatar } from '../lib/profile'
import { loadCourierDashboard, type CourierDashboard } from '../lib/staffStats'
import { loadMyOrders, type MyOrder } from '../lib/myOrders'
import { isStaffRole, ROLE_LABELS } from '../lib/roles'
import { formatDzd, formatWhen } from '../lib/format'
import WeeklyStats from '../components/WeeklyStats'
import RatingStars from '../components/RatingStars'

type Props = {
  profile: Account
  onProfileChange: (next: Account) => void
  onSignOut: () => void
  onOpenOrder?: (orderId: string) => void
  onBack: () => void
}

const ACTIVE_STATUSES = ['pending', 'accepted', 'picked_up', 'in_transit']

/**
 * Personal profile for every account.
 *
 * The photo goes through `uploadAvatar` (downscaled in the browser, then
 * stored in the public `avatars` bucket under `<user-id>/`), and the row is
 * saved through `update_my_profile`, which ignores any `role` change — the
 * role can only be altered by the server.
 */
export default function Profile({ profile, onProfileChange, onSignOut, onOpenOrder, onBack }: Props) {
  const [name, setName] = useState(profile.full_name)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [dashboard, setDashboard] = useState<CourierDashboard | null>(null)
  const [dashboardError, setDashboardError] = useState('')
  const [dashboardLoading, setDashboardLoading] = useState(false)
  const [orders, setOrders] = useState<MyOrder[]>([])
  const [ordersLoading, setOrdersLoading] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const staff = isStaffRole(profile.role)
  const courierLike = profile.role === 'courier' || profile.role === 'employee'

  const loadDashboard = useCallback(async () => {
    if (!courierLike) return
    setDashboardLoading(true)
    setDashboardError('')
    const result = await loadCourierDashboard(profile.id)
    setDashboardLoading(false)
    if (!result.ok) {
      setDashboardError(result.error)
      return
    }
    setDashboard(result.dashboard)
  }, [courierLike, profile.id])

  const loadOrders = useCallback(async () => {
    if (staff) return
    setOrdersLoading(true)
    const result = await loadMyOrders()
    setOrdersLoading(false)
    if (result.ok) setOrders(result.orders)
  }, [staff])

  useEffect(() => { void loadDashboard() }, [loadDashboard])
  useEffect(() => { void loadOrders() }, [loadOrders])
  useEffect(() => { setName(profile.full_name) }, [profile.full_name])

  async function pickPhoto(file: File | null) {
    if (!file) return
    setError('')
    setNotice('')
    setUploading(true)
    const uploaded = await uploadAvatar(profile.id, file)
    if (!uploaded.ok) {
      setUploading(false)
      setError(uploaded.error)
      return
    }
    const saved = await updateMyProfile({ avatarUrl: uploaded.url })
    setUploading(false)
    if (!saved.ok) {
      setError(saved.error)
      return
    }
    onProfileChange({ ...profile, avatar_url: uploaded.url })
    setNotice('تم تحديث الصورة الشخصية.')
  }

  async function removePhoto() {
    setError('')
    setNotice('')
    setUploading(true)
    const saved = await updateMyProfile({ avatarUrl: null })
    setUploading(false)
    if (!saved.ok) {
      setError(saved.error)
      return
    }
    onProfileChange({ ...profile, avatar_url: null })
    setNotice('تم حذف الصورة الشخصية.')
  }

  async function saveName(event: React.FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (trimmed.length < 2) {
      setError('الاسم يجب أن يكون حرفين على الأقل.')
      return
    }
    if (trimmed === profile.full_name) return
    setSaving(true)
    setError('')
    setNotice('')
    const saved = await updateMyProfile({ fullName: trimmed })
    setSaving(false)
    if (!saved.ok) {
      setError(saved.error)
      return
    }
    onProfileChange({ ...profile, full_name: trimmed })
    setNotice('تم حفظ الاسم.')
  }

  const activeOrders = orders.filter(order => ACTIVE_STATUSES.includes(order.status))
  const pastOrders = orders.filter(order => order.status === 'delivered' || order.status === 'cancelled')

  return (
    <section className="page-section profile-page">
      <div className="profile-head">
        <button className="secondary-button" onClick={onBack}><ArrowLeft size={16} /> رجوع</button>
        <span className="eyebrow">الملف الشخصي</span>
      </div>

      <div className="profile-card">
        <div className="profile-avatar-wrap">
          <span className="profile-avatar">
            {profile.avatar_url
              ? <img src={profile.avatar_url} alt="" />
              : <span className="profile-avatar-fallback">{avatarInitials(profile.full_name)}</span>}
            {uploading && <span className="profile-avatar-busy"><Loader2 size={18} className="spin" /></span>}
          </span>
          <div className="profile-avatar-actions">
            <button type="button" className="secondary-button small" onClick={() => fileRef.current?.click()} disabled={uploading}>
              <Camera size={15} /> تغيير الصورة
            </button>
            {profile.avatar_url && (
              <button type="button" className="text-button danger" onClick={() => void removePhoto()} disabled={uploading}>
                <Trash2 size={14} /> حذف
              </button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="visually-hidden"
            onChange={event => {
              const file = event.target.files?.[0] ?? null
              event.target.value = ''
              void pickPhoto(file)
            }}
          />
        </div>

        <div className="profile-identity">
          <form className="profile-name-form" onSubmit={saveName}>
            <label>
              <span>الاسم</span>
              <input value={name} onChange={event => setName(event.target.value)} maxLength={60} />
            </label>
            <button type="submit" className="primary-button small" disabled={saving || name.trim() === profile.full_name}>
              {saving ? <Loader2 size={15} className="spin" /> : <CheckCircle2 size={15} />} حفظ
            </button>
          </form>

          <dl className="profile-facts">
            <div><dt><Phone size={14} /> الهاتف</dt><dd dir="ltr">{profile.phone || '—'}</dd></div>
            <div><dt><ShieldCheck size={14} /> نوع الحساب</dt><dd>{ROLE_LABELS[profile.role]}</dd></div>
            {courierLike && (
              <div>
                <dt><Star size={14} /> التقييم</dt>
                <dd>
                  {dashboard?.ratingAvg != null
                    ? <span className="profile-rating"><RatingStars value={dashboard.ratingAvg} size={13} /> <b>{dashboard.ratingAvg.toFixed(1)}</b> <small>({dashboard.ratingCount})</small></span>
                    : 'لا تقييمات بعد'}
                </dd>
              </div>
            )}
          </dl>

          {error && <div className="inline-alert danger" role="alert">{error}</div>}
          {notice && (
            <div className="inline-alert success" role="status">
              <CheckCircle2 size={16} /> {notice}
              <button type="button" className="alert-dismiss" onClick={() => setNotice('')} aria-label="إغلاق">×</button>
            </div>
          )}
        </div>
      </div>

      {courierLike && (
        <>
          <div className="profile-section-head">
            <h2>لوحة الأداء</h2>
            <button type="button" className="text-button" onClick={() => void loadDashboard()} disabled={dashboardLoading}>
              {dashboardLoading ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} تحديث
            </button>
          </div>
          <WeeklyStats dashboard={dashboard} loading={dashboardLoading} error={dashboardError} />
        </>
      )}

      {!staff && (
        <>
          <div className="profile-section-head">
            <h2>طلباتي</h2>
            <span className="muted">{orders.length} طلب</span>
          </div>

          <div className="profile-order-kpis">
            <div><Clock3 size={16} /><span>جارية الآن</span><b>{activeOrders.length}</b></div>
            <div><CheckCircle2 size={16} /><span>منتهية</span><b>{pastOrders.length}</b></div>
          </div>

          {ordersLoading ? (
            <div className="empty-state">جارٍ تحميل الطلبات…</div>
          ) : orders.length === 0 ? (
            <div className="empty-state"><UserRound size={30} /><b>لا طلبات بعد</b><span>ستظهر هنا طلباتك الحالية والسابقة.</span></div>
          ) : (
            <ul className="profile-orders">
              {orders.slice(0, 8).map(order => (
                <li key={order.id}>
                  <button type="button" className="profile-order" onClick={() => onOpenOrder?.(order.id)}>
                    <span className={`status status-${order.status}`}>{order.status === 'delivered' ? 'مكتمل' : order.status === 'cancelled' ? 'ملغي' : 'جاري'}</span>
                    <span className="profile-order-route">{order.pickup} ← {order.dropoff}</span>
                    <small>{order.order_code ? `#${order.order_code} · ` : ''}{formatWhen(order.created_at)}</small>
                    <b>{order.price_dzd ? formatDzd(order.price_dzd) : '—'}</b>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <button type="button" className="danger-button profile-logout" onClick={onSignOut}>
        <LogOut size={16} /> تسجيل الخروج
      </button>
    </section>
  )
}
