import { useEffect, useMemo, useState } from 'react'
import {
  Bike, CheckCircle2, ClipboardList, Clock3, Loader2, LogOut,
  Phone, RefreshCw, Search, ShieldAlert, UserRound, Users, Wallet, XCircle
} from 'lucide-react'
import type { AppRole, Profile } from '../lib/auth'
import { ROLE_LABELS } from '../lib/roles'
import {
  loadAdminApplications, reviewCourierApplication,
  type AdminCourierApplication, type ReviewDecision
} from '../lib/courierApply'
import { loadAdminAccounts, loadOverviewStats, type AdminAccount, type OverviewStats } from '../lib/adminAccounts'
import { serviceTitle } from '../lib/services'
import {
  adminForwardStatuses, advanceStaffOrder, canAdminCancel, loadStaffOrders,
  type OrderStatus, type StaffOrder
} from '../lib/staffOrders'

type Props = {
  profile: Profile
  onExit: () => void
}

type Tab = 'overview' | 'applications' | 'accounts' | 'orders'

const STATUS_LABELS: Record<string, string> = {
  pending: 'بانتظار موصّل',
  accepted: 'تم القبول',
  picked_up: 'تم الاستلام',
  in_transit: 'في الطريق',
  delivered: 'تم التسليم',
  cancelled: 'ملغي'
}

const APPLY_LABELS: Record<string, string> = {
  pending: 'قيد المراجعة',
  approved: 'معتمد',
  rejected: 'مرفوض'
}

const VEHICLE_LABELS: Record<string, string> = {
  motorcycle: 'دراجة نارية',
  car: 'سيارة'
}

const formatDzd = (amount: number) => `${new Intl.NumberFormat('fr-DZ').format(amount)} دج`
const toLocal = (e164: string) => e164.replace(/^\+213/, '0')
const shortId = (id: string) => id.replace(/-/g, '').slice(0, 8)

function formatWhen(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('ar-DZ')
}

export default function AdminDesk({ profile, onExit }: Props) {
  const [tab, setTab] = useState<Tab>('overview')
  const [applications, setApplications] = useState<AdminCourierApplication[]>([])
  const [orders, setOrders] = useState<StaffOrder[]>([])
  const [accounts, setAccounts] = useState<AdminAccount[]>([])
  const [loadingApps, setLoadingApps] = useState(true)
  const [loadingOrders, setLoadingOrders] = useState(true)
  const [loadingAccounts, setLoadingAccounts] = useState(true)
  const [appsError, setAppsError] = useState('')
  const [ordersError, setOrdersError] = useState('')
  const [accountsError, setAccountsError] = useState('')
  const [actionError, setActionError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rejectId, setRejectId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null)
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null)
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null)
  const [accountQuery, setAccountQuery] = useState('')
  const [accountRole, setAccountRole] = useState<'all' | AppRole>('all')
  const [accountVerify, setAccountVerify] = useState<'all' | 'verified' | 'unverified'>('all')
  const [orderQuery, setOrderQuery] = useState('')
  const [orderStatus, setOrderStatus] = useState<'all' | OrderStatus>('all')
  const [appStatus, setAppStatus] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all')
  const [accountsLoaded, setAccountsLoaded] = useState(0)
  const [accountsTotal, setAccountsTotal] = useState<number | null>(null)
  const [accountsTruncated, setAccountsTruncated] = useState(false)
  const [stats, setStats] = useState<OverviewStats>({
    customers: null, employees: null, couriers: null, admins: null,
    verifiedCouriers: null, pendingApplications: null,
    ordersActive: null, ordersDelivered: null, ordersCancelled: null,
    source: 'unavailable'
  })

  async function refreshApplications() {
    setLoadingApps(true)
    setAppsError('')
    const result = await loadAdminApplications()
    setLoadingApps(false)
    if (!result.ok) {
      setAppsError(result.error)
      setApplications([])
      return
    }
    setApplications(result.applications)
    setSelectedAppId(current =>
      current && result.applications.some(item => item.userId === current)
        ? current
        : result.applications[0]?.userId ?? null
    )
  }

  async function refreshOrders() {
    setLoadingOrders(true)
    setOrdersError('')
    const result = await loadStaffOrders()
    setLoadingOrders(false)
    if (!result.ok) {
      setOrdersError(result.error)
      setOrders([])
      return
    }
    setOrders(result.orders)
    setSelectedOrderId(current =>
      current && result.orders.some(item => item.id === current)
        ? current
        : result.orders[0]?.id ?? null
    )
  }

  async function refreshAccounts() {
    setLoadingAccounts(true)
    setAccountsError('')
    const [list, nextStats] = await Promise.all([loadAdminAccounts(), loadOverviewStats()])
    setLoadingAccounts(false)
    setStats(nextStats)
    if (!list.ok) {
      setAccountsError(list.error)
      setAccounts([])
      setAccountsLoaded(0)
      setAccountsTotal(null)
      setAccountsTruncated(false)
      return
    }
    setAccounts(list.accounts)
    setAccountsLoaded(list.loaded)
    setAccountsTotal(list.total)
    setAccountsTruncated(list.truncated)
    setSelectedAccountId(current =>
      current && list.accounts.some(item => item.id === current)
        ? current
        : list.accounts[0]?.id ?? null
    )
  }

  useEffect(() => {
    void refreshApplications()
    void refreshOrders()
    void refreshAccounts()
  }, [])

  const selectedApp = useMemo(
    () => applications.find(item => item.userId === selectedAppId) || null,
    [applications, selectedAppId]
  )
  const selectedOrder = useMemo(
    () => orders.find(item => item.id === selectedOrderId) || null,
    [orders, selectedOrderId]
  )
  const selectedAccount = useMemo(
    () => accounts.find(item => item.id === selectedAccountId) || null,
    [accounts, selectedAccountId]
  )

  function formatStat(value: number | null): string {
    return value == null ? '—' : String(value)
  }

  const filteredAccounts = useMemo(() => {
    const q = accountQuery.trim().toLowerCase()
    return accounts.filter(item => {
      if (accountRole !== 'all' && item.role !== accountRole) return false
      if (accountVerify === 'verified' && item.courierVerified !== true) return false
      if (accountVerify === 'unverified' && item.courierVerified !== false) return false
      if (!q) return true
      return `${item.fullName} ${item.phone} ${item.id}`.toLowerCase().includes(q)
    })
  }, [accounts, accountQuery, accountRole, accountVerify])

  const filteredOrders = useMemo(() => {
    const q = orderQuery.trim().toLowerCase()
    return orders.filter(item => {
      if (orderStatus !== 'all' && item.status !== orderStatus) return false
      if (!q) return true
      return `${item.customer_name} ${item.phone} ${item.pickup} ${item.dropoff} ${item.id} ${item.courier_id || ''}`.toLowerCase().includes(q)
    })
  }, [orders, orderQuery, orderStatus])

  async function decide(item: AdminCourierApplication, decision: ReviewDecision) {
    if (decision === 'rejected' && rejectId !== item.userId) {
      setRejectId(item.userId)
      setRejectReason('')
      return
    }
    setBusyId(item.userId)
    setActionError('')
    const result = await reviewCourierApplication(
      item.userId,
      decision,
      decision === 'rejected' ? rejectReason : ''
    )
    setBusyId(null)
    if (!result.ok) {
      setActionError(result.error)
      return
    }
    setRejectId(null)
    setRejectReason('')
    await Promise.all([refreshApplications(), refreshAccounts()])
  }

  async function changeOrderStatus(order: StaffOrder, next: OrderStatus) {
    if (next === order.status) return
    setBusyId(order.id)
    setActionError('')
    const result = await advanceStaffOrder(order.id, next)
    setBusyId(null)
    if (!result.ok) {
      setActionError(result.error)
      return
    }
    await refreshOrders()
  }

  function refreshCurrent() {
    if (tab === 'applications') void refreshApplications()
    else if (tab === 'orders') void refreshOrders()
    else if (tab === 'accounts') void refreshAccounts()
    else {
      void refreshApplications()
      void refreshOrders()
      void refreshAccounts()
    }
  }

  const loading = tab === 'applications' ? loadingApps : tab === 'orders' ? loadingOrders : tab === 'accounts' ? loadingAccounts : (loadingApps || loadingOrders || loadingAccounts)

  return (
    <section className="admin-shell">
      <aside className="admin-side">
        <div className="admin-side-brand">
          <span className="brand-mark"><img src="/brand/logo-mark.webp" alt="ERSEL" /></span>
          <span><b>ERSEL</b><small>لوحة الإدارة</small></span>
        </div>
        <nav>
          <button type="button" className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>نظرة عامة</button>
          <button type="button" className={tab === 'applications' ? 'active' : ''} onClick={() => setTab('applications')}>طلبات الموصّلين</button>
          <button type="button" className={tab === 'accounts' ? 'active' : ''} onClick={() => setTab('accounts')}>الحسابات</button>
          <button type="button" className={tab === 'orders' ? 'active' : ''} onClick={() => setTab('orders')}>الطلبيات</button>
        </nav>
        <p className="admin-side-user">{profile.full_name || 'مدير'} · {ROLE_LABELS.admin}</p>
        <button className="secondary-button" type="button" onClick={onExit}><LogOut size={16} /> إغلاق اللوحة</button>
      </aside>

      <div className="admin-main">
        <header className="admin-main-head">
          <div>
            <span className="eyebrow">مركز التحكم</span>
            <h1 className="page-title">كلش يجي لعندك</h1>
          </div>
          <button className="secondary-button" onClick={refreshCurrent} disabled={loading}>
            {loading ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />} تحديث
          </button>
        </header>

        {actionError && <div className="inline-alert danger" role="alert">{actionError}</div>}

        {tab === 'overview' && (
          <>
            <div className="desk-stats admin-stats-grid">
              <div><Users size={16} /><span>حسابات الزبائن</span><b>{formatStat(stats.customers)}</b></div>
              <div><Bike size={16} /><span>موصّلون معتمدون</span><b>{formatStat(stats.verifiedCouriers)}</b></div>
              <div><UserRound size={16} /><span>موظفون</span><b>{formatStat(stats.employees)}</b></div>
              <div><Clock3 size={16} /><span>انضمام قيد المراجعة</span><b>{formatStat(stats.pendingApplications)}</b></div>
              <div><ClipboardList size={16} /><span>طلبيات جارية</span><b>{formatStat(stats.ordersActive)}</b></div>
              <div><CheckCircle2 size={16} /><span>مكتملة</span><b>{formatStat(stats.ordersDelivered)}</b></div>
              <div><XCircle size={16} /><span>ملغاة</span><b>{formatStat(stats.ordersCancelled)}</b></div>
              <div><Wallet size={16} /><span>مديرون</span><b>{formatStat(stats.admins)}</b></div>
            </div>
            <p className="muted">
              {stats.source === 'rpc'
                ? 'الأرقام من دالة الإحصائيات في الخادم، وليست عينة من الصفحة.'
                : stats.source === 'exact'
                  ? 'الأرقام من عدّ دقيق عبر صلاحية المدير، وليست عدد الصفوف المعروضة في القوائم.'
                  : 'تعذّر عدّ الإحصائيات. لم نعرض أرقام العينة المحدودة على أنها كلية.'}
            </p>
            {(appsError || ordersError || accountsError || stats.source === 'unavailable') && (
              <div className="inline-alert warning" role="alert">
                <ShieldAlert size={18} /> تعذّر تحميل بعض الإحصائيات. لم نتجاوز سياسات الأمان.
              </div>
            )}
            <h2 className="admin-subtitle">أحدث الطلبات</h2>
            {!orders.length ? (
              <div className="empty-state"><ClipboardList size={34} /><b>لا توجد طلبات معروضة</b><span>ستظهر الطلبات الحقيقية بعد إنشائها.</span></div>
            ) : (
              <div className="orders-list">
                {orders.slice(0, 8).map(order => (
                  <article className="order-row" key={order.id}>
                    <div className="order-main">
                      <b>{serviceTitle(order.service)}</b>
                      <span>{order.pickup} ← {order.dropoff}</span>
                      <small>{order.customer_name || '—'} · {shortId(order.id)}</small>
                    </div>
                    <div className="order-meta">
                      <span className={`status status-${order.status}`}>{STATUS_LABELS[order.status]}</span>
                      <b>{order.price_dzd ? formatDzd(order.price_dzd) : '—'}</b>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </>
        )}

        {tab === 'applications' && (
          <>
            {appsError && <div className="inline-alert warning" role="alert"><ShieldAlert size={18} /> {appsError}</div>}
            <div className="toolbar">
              <select value={appStatus} onChange={event => setAppStatus(event.target.value as 'all' | 'pending' | 'approved' | 'rejected')} aria-label="تصفية حالة طلب الانضمام">
                <option value="all">كل الطلبات</option>
                <option value="pending">قيد المراجعة</option>
                <option value="approved">معتمد</option>
                <option value="rejected">مرفوض</option>
              </select>
            </div>
            {applications.length >= 80 && (
              <p className="muted">تُعرض أحدث 80 طلب انضمام. العدد الكلي قيد المراجعة يظهر في النظرة العامة إن توفر العدّ الدقيق.</p>
            )}
            {loadingApps ? (
              <div className="empty-state">جارٍ تحميل طلبات الانضمام…</div>
            ) : !applications.length && !appsError ? (
              <div className="empty-state"><Bike size={34} /><b>لا توجد طلبات انضمام</b><span>ستظهر هنا الطلبات الحقيقية بعد إرسالها.</span></div>
            ) : !applications.filter(item => appStatus === 'all' || item.status === appStatus).length ? (
              <div className="empty-state"><Bike size={34} /><b>لا توجد طلبات مطابقة</b><span>غيّر عامل التصفية لعرض طلبات أخرى.</span></div>
            ) : (
              <div className="desk-layout">
                <div className="desk-list">
                  {applications.filter(item => appStatus === 'all' || item.status === appStatus).map(item => (
                    <button
                      key={item.userId}
                      type="button"
                      className={item.userId === selectedAppId ? 'desk-item selected' : 'desk-item'}
                      onClick={() => setSelectedAppId(item.userId)}
                    >
                      <b>{item.firstName} {item.lastName}</b>
                      <span>{VEHICLE_LABELS[item.vehicle]} · {item.city}</span>
                      <small>
                        <span className={`status status-${item.status === 'approved' ? 'delivered' : item.status === 'rejected' ? 'cancelled' : 'pending'}`}>
                          {APPLY_LABELS[item.status]}
                        </span>
                        {` · ${formatWhen(item.createdAt)}`}
                      </small>
                    </button>
                  ))}
                </div>
                {selectedApp && (
                  <article className="desk-detail">
                    <header>
                      <span className={`status status-${selectedApp.status === 'approved' ? 'delivered' : selectedApp.status === 'rejected' ? 'cancelled' : 'pending'}`}>
                        {APPLY_LABELS[selectedApp.status]}
                      </span>
                      <h2>{selectedApp.firstName} {selectedApp.lastName}</h2>
                    </header>
                    <dl className="summary-list">
                      <div><dt><Phone size={14} /> الهاتف</dt><dd dir="ltr">{toLocal(selectedApp.phone)}</dd></div>
                      <div><dt><UserRound size={14} /> العمر</dt><dd>{selectedApp.ageYears} سنة</dd></div>
                      <div><dt>المركبة</dt><dd>{VEHICLE_LABELS[selectedApp.vehicle]}</dd></div>
                      {(selectedApp.vehicleMake || selectedApp.vehicleModel) && (
                        <div><dt>الطراز</dt><dd>{[selectedApp.vehicleMake, selectedApp.vehicleModel].filter(Boolean).join(' ')}</dd></div>
                      )}
                      {selectedApp.vehiclePlate && <div><dt>اللوحة</dt><dd dir="ltr">{selectedApp.vehiclePlate}</dd></div>}
                      <div><dt>تاريخ الإرسال</dt><dd>{formatWhen(selectedApp.createdAt)}</dd></div>
                      {selectedApp.rejectionReason && <div><dt>سبب الرفض</dt><dd>{selectedApp.rejectionReason}</dd></div>}
                    </dl>
                    {selectedApp.status === 'pending' && (
                      <div className="desk-actions">
                        <button className="primary-button" disabled={busyId === selectedApp.userId} onClick={() => void decide(selectedApp, 'approved')}>
                          {busyId === selectedApp.userId ? <Loader2 size={16} className="spin" /> : <CheckCircle2 size={16} />}
                          قبول الطلب
                        </button>
                        <button className="secondary-button" disabled={busyId === selectedApp.userId} onClick={() => void decide(selectedApp, 'rejected')}>
                          <XCircle size={16} /> رفض
                        </button>
                      </div>
                    )}
                    {rejectId === selectedApp.userId && (
                      <div className="reject-box">
                        <label>
                          سبب الرفض
                          <textarea rows={3} value={rejectReason} onChange={event => setRejectReason(event.target.value)} maxLength={300} placeholder="اختياري، يظهر لصاحب الطلب" />
                        </label>
                        <div className="desk-actions">
                          <button className="primary-button" disabled={busyId === selectedApp.userId} onClick={() => void decide(selectedApp, 'rejected')}>تأكيد الرفض</button>
                          <button className="text-button" type="button" onClick={() => setRejectId(null)}>إلغاء</button>
                        </div>
                      </div>
                    )}
                  </article>
                )}
              </div>
            )}
          </>
        )}

        {tab === 'accounts' && (
          <>
            {accountsError && <div className="inline-alert warning" role="alert"><ShieldAlert size={18} /> {accountsError}</div>}
            <div className="toolbar">
              <div className="search-box"><Search size={18} /><input value={accountQuery} onChange={event => setAccountQuery(event.target.value)} placeholder="بحث بالاسم أو الهاتف أو المعرّف" /></div>
              <select value={accountRole} onChange={event => setAccountRole(event.target.value as 'all' | AppRole)} aria-label="تصفية نوع الحساب">
                <option value="all">كل الأدوار</option>
                <option value="customer">زبون</option>
                <option value="employee">موظف</option>
                <option value="courier">موصّل</option>
                <option value="admin">مدير</option>
              </select>
              <select value={accountVerify} onChange={event => setAccountVerify(event.target.value as 'all' | 'verified' | 'unverified')} aria-label="تصفية اعتماد الموصّل">
                <option value="all">كل الحالات</option>
                <option value="verified">موصّل معتمد</option>
                <option value="unverified">موصّل غير معتمد</option>
              </select>
            </div>
            {accountsTruncated && (
              <p className="muted">تُعرض أحدث {accountsLoaded} حساباً{accountsTotal != null ? ` من أصل ${accountsTotal}` : ''}. البحث يعمل داخل هذه الصفحة فقط.</p>
            )}
            {loadingAccounts ? (
              <div className="empty-state">جارٍ تحميل الحسابات…</div>
            ) : !filteredAccounts.length && !accountsError ? (
              <div className="empty-state"><Users size={34} /><b>لا توجد حسابات مطابقة</b><span>القائمة تعرض الصفوف التي تسمح بها صلاحية المدير فقط.</span></div>
            ) : (
              <div className="desk-layout">
                <div className="desk-list">
                  {filteredAccounts.map(item => (
                    <button
                      key={item.id}
                      type="button"
                      className={item.id === selectedAccountId ? 'desk-item selected' : 'desk-item'}
                      onClick={() => setSelectedAccountId(item.id)}
                    >
                      <b>{item.fullName || 'بدون اسم'}</b>
                      <span dir="ltr">{item.phone ? toLocal(item.phone) : '—'}</span>
                      <small>{ROLE_LABELS[item.role]}{item.courierVerified === true ? ' · معتمد' : item.courierVerified === false ? ' · غير معتمد' : ''}</small>
                    </button>
                  ))}
                </div>
                {selectedAccount && (
                  <article className="desk-detail">
                    <header>
                      <span className="status status-accepted">{ROLE_LABELS[selectedAccount.role]}</span>
                      <h2>{selectedAccount.fullName || 'بدون اسم'}</h2>
                    </header>
                    <dl className="summary-list">
                      <div><dt>المعرّف</dt><dd dir="ltr">{selectedAccount.id}</dd></div>
                      <div><dt>الهاتف</dt><dd dir="ltr">{selectedAccount.phone ? toLocal(selectedAccount.phone) : '—'}</dd></div>
                      <div><dt>الدور</dt><dd>{ROLE_LABELS[selectedAccount.role]}</dd></div>
                      {selectedAccount.role === 'courier' && (
                        <div><dt>اعتماد الموصّل</dt><dd>{selectedAccount.courierVerified === true ? 'معتمد' : selectedAccount.courierVerified === false ? 'غير معتمد' : 'غير متاح من الخادم'}</dd></div>
                      )}
                      <div><dt>تاريخ الإنشاء</dt><dd>{formatWhen(selectedAccount.createdAt)}</dd></div>
                      <div><dt>الحالة التشغيلية</dt><dd>نشط في الواجهة — تعطيل الحساب غير مفعّل على الخادم</dd></div>
                    </dl>
                    <p className="field-hint">لا يمكن تغيير الدور أو تعطيل الحساب من المتصفح. ذلك يحتاج دالة خادم معتمدة ولم تُنفَّذ بعد.</p>
                  </article>
                )}
              </div>
            )}
          </>
        )}

        {tab === 'orders' && (
          <>
            {ordersError && <div className="inline-alert warning" role="alert"><ShieldAlert size={18} /> {ordersError}</div>}
            <div className="toolbar">
              <div className="search-box"><Search size={18} /><input value={orderQuery} onChange={event => setOrderQuery(event.target.value)} placeholder="بحث بالاسم أو العنوان أو الموصّل" /></div>
              <select value={orderStatus} onChange={event => setOrderStatus(event.target.value as 'all' | OrderStatus)} aria-label="تصفية حالة الطلب">
                <option value="all">كل الحالات</option>
                <option value="pending">بانتظار موصّل</option>
                <option value="accepted">مقبول</option>
                <option value="picked_up">تم الاستلام</option>
                <option value="in_transit">في الطريق</option>
                <option value="delivered">تم التسليم</option>
                <option value="cancelled">ملغي</option>
              </select>
            </div>
            {orders.length >= 80 && (
              <p className="muted">تُعرض أحدث 80 طلبية. الأرقام الكلية في النظرة العامة تأتي من العدّ الدقيق وليس من هذه القائمة.</p>
            )}
            {loadingOrders ? (
              <div className="empty-state">جارٍ تحميل الطلبات…</div>
            ) : !filteredOrders.length && !ordersError ? (
              <div className="empty-state"><ClipboardList size={34} /><b>لا توجد طلبات مطابقة</b><span>ستظهر الطلبات المحفوظة فعلياً.</span></div>
            ) : (
              <div className="desk-layout">
                <div className="desk-list">
                  {filteredOrders.map(order => (
                    <button
                      key={order.id}
                      type="button"
                      className={order.id === selectedOrderId ? 'desk-item selected' : 'desk-item'}
                      onClick={() => setSelectedOrderId(order.id)}
                    >
                      <b>{serviceTitle(order.service)}</b>
                      <span>{order.pickup} ← {order.dropoff}</span>
                      <small>
                        <span className={`status status-${order.status}`}>{STATUS_LABELS[order.status]}</span>
                        {order.price_dzd ? ` · ${formatDzd(order.price_dzd)}` : ''}
                      </small>
                    </button>
                  ))}
                </div>
                {selectedOrder && (
                  <article className="desk-detail">
                    <header>
                      <span className={`status status-${selectedOrder.status}`}>{STATUS_LABELS[selectedOrder.status]}</span>
                      <h2>{serviceTitle(selectedOrder.service)}</h2>
                    </header>
                    <dl className="summary-list">
                      <div><dt>رقم الطلب</dt><dd dir="ltr">{selectedOrder.id}</dd></div>
                      <div><dt>الاستلام</dt><dd>{selectedOrder.pickup}</dd></div>
                      <div><dt>التسليم</dt><dd>{selectedOrder.dropoff}</dd></div>
                      <div><dt>السعر</dt><dd>{selectedOrder.price_dzd ? formatDzd(selectedOrder.price_dzd) : 'غير محدد'}</dd></div>
                      <div><dt>التواصل</dt><dd dir="ltr">{selectedOrder.phone ? toLocal(selectedOrder.phone) : '—'}</dd></div>
                      {selectedOrder.customer_name && <div><dt>الاسم</dt><dd>{selectedOrder.customer_name}</dd></div>}
                      <div><dt>الموصّل</dt><dd dir="ltr">{selectedOrder.courier_id || 'غير مسند'}</dd></div>
                      <div><dt>تاريخ الإنشاء</dt><dd>{formatWhen(selectedOrder.created_at)}</dd></div>
                      <div><dt>آخر تحديث</dt><dd>{formatWhen(selectedOrder.updated_at)}</dd></div>
                      {selectedOrder.details && <div><dt>التفاصيل</dt><dd>{selectedOrder.details}</dd></div>}
                      {selectedOrder.notes && <div><dt>ملاحظات</dt><dd>{selectedOrder.notes}</dd></div>}
                    </dl>
                    <div className="desk-actions">
                      {adminForwardStatuses(selectedOrder.status).map(next => (
                        <button
                          key={next}
                          className="primary-button"
                          type="button"
                          disabled={busyId === selectedOrder.id}
                          onClick={() => void changeOrderStatus(selectedOrder, next)}
                        >
                          {busyId === selectedOrder.id ? <Loader2 size={16} className="spin" /> : <CheckCircle2 size={16} />}
                          {next === 'accepted' ? 'قبول الطلب' : next === 'picked_up' ? 'تأكيد الاستلام' : next === 'in_transit' ? 'بدء التوصيل' : 'إتمام التسليم'}
                        </button>
                      ))}
                      {canAdminCancel(selectedOrder.status) && (
                        <button
                          className="secondary-button"
                          type="button"
                          disabled={busyId === selectedOrder.id}
                          onClick={() => void changeOrderStatus(selectedOrder, 'cancelled')}
                        >
                          <XCircle size={16} /> إلغاء الطلب
                        </button>
                      )}
                    </div>
                    <p className="field-hint">الحالة تتقدم عبر الخادم فقط وفق السلسلة المعتمدة. إعادة الإسناد إلى موصّل آخر غير مفعّلة بعد.</p>
                  </article>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}
