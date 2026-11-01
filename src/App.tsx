import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import {
  Bike, ChevronLeft, ClipboardList, Download,
  LogOut, Menu, PackageCheck, Search, ShoppingBag,
  Truck, Wallet, X, ArrowLeft, LogIn, UserRound, Smartphone
} from 'lucide-react'
import { isSupabaseConfigured } from './lib/supabase'
import { useAuth } from './hooks/useAuth'
import Splash from './components/Splash'
import Onboarding from './components/Onboarding'
import AuthScreen from './components/AuthScreen'
import TrackOrder from './pages/TrackOrder'
import MyOrders from './pages/MyOrders'
import ProfilePage from './pages/Profile'
import NotificationBell from './components/NotificationBell'
import CourierApply from './components/CourierApply'
import AdminGate from './components/AdminGate'
import AndroidInstall from './components/AndroidInstall'
const QuickOrder = lazy(() => import('./components/QuickOrder'))
const EmployeeDesk = lazy(() => import('./components/EmployeeDesk'))
const AdminDesk = lazy(() => import('./components/AdminDesk'))
const CodeDesk = lazy(() => import('./components/CodeDesk'))
import { SERVICES } from './lib/services'
import type { AppRole, Profile } from './lib/auth'
import { unlockAdminWithCode, verifyAdminAccess } from './lib/auth'
import { fetchCodeDesk, type CodeDeskPayload } from './lib/codeDesk'
import type { ServiceId } from './lib/services'
import { homePageForRole, isStaffRole, ROLE_LABELS, type AppPage } from './lib/roles'
import { useOrderNotifications } from './hooks/useOrderNotifications'
import { hasApkLink } from './lib/release'
import { avatarInitials } from './lib/profile'

const ONBOARDING_KEY = 'ersel_onboarding_done_v1'
const ADMIN_TAP_WINDOW_MS = 1800

type Service = ServiceId
const services = SERVICES

export default function App() {
  const {
    session, profile, status: authStatus, profileStatus,
    error: authError, profileError, retry: retryAuth, retryProfile, applyVerifiedProfile, signOut
  } = useAuth()
  const [minSplash, setMinSplash] = useState(false)
  const [onboardingDone, setOnboardingDone] = useState(() => localStorage.getItem(ONBOARDING_KEY) === '1')
  const initialTrackToken = (() => {
    if (typeof window === 'undefined') return ''
    const match = window.location.hash.match(/^#track=(.+)$/)
    return match ? decodeURIComponent(match[1]) : ''
  })()
  const [trackToken, setTrackToken] = useState(initialTrackToken)
  const [guest, setGuest] = useState(!!initialTrackToken || !isSupabaseConfigured)
  const [page, setPage] = useState<AppPage>(initialTrackToken ? 'track' : 'home')
  const [lastRoutedUser, setLastRoutedUser] = useState<string | null>(null)
  const [selectedService, setSelectedService] = useState<Service>('parcel')
  const [notice, setNotice] = useState('')
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [showAdminGate, setShowAdminGate] = useState(false)
  const [adminUnlocked, setAdminUnlocked] = useState(false)
  const [codeDesk, setCodeDesk] = useState<{ code: string; data: CodeDeskPayload } | null>(null)
  const logoTaps = useRef(0)
  const logoTapTimer = useRef<number | null>(null)

  const userId = session?.user?.id ?? null
  const role: AppRole | null = profile?.role ?? null
  const isAndroidDevice = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)
  const [showApkSheet, setShowApkSheet] = useState(false)
  const [unreadNotifications, setUnreadNotifications] = useState(0)
  const [focusOrderId, setFocusOrderId] = useState<string | null>(null)
  const [deskRefreshKey, setDeskRefreshKey] = useState(0)
  const openApkSheet = useCallback(() => setShowApkSheet(true), [])
  const closeApkSheet = useCallback(() => setShowApkSheet(false), [])
  const clearFocus = useCallback(() => setFocusOrderId(null), [])

  /** Notification tap → open the order in the screen that owns it. */
  const openOrderFromNotification = useCallback((orderId: string) => {
    setFocusOrderId(orderId)
    setNotice('')
    setPage(current => {
      if (current === 'orders' || current === 'desk') return current
      return isStaffRole(role) ? 'desk' : 'orders'
    })
  }, [role])

  const onNewOrderNotification = useCallback(() => {
    setDeskRefreshKey(key => key + 1)
  }, [])

  useOrderNotifications({
    userId,
    onOpenOrder: openOrderFromNotification,
    onUnread: setUnreadNotifications,
    onNewOrder: onNewOrderNotification
  })

  useEffect(() => {
    const timer = setTimeout(() => setMinSplash(true), 700)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (!userId || profileStatus !== 'ready' || !role) return
    if (lastRoutedUser === userId) return
    setLastRoutedUser(userId)
    setPage(homePageForRole(role))
  }, [userId, profileStatus, role, lastRoutedUser])

  useEffect(() => {
    function onHashChange() {
      const match = window.location.hash.match(/^#track=(.+)$/)
      if (!match) return
      setTrackToken(decodeURIComponent(match[1]))
      setGuest(true)
      setPage('track')
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const fromQuery = params.get('order')
    if (fromQuery) openOrderFromNotification(fromQuery)
  }, [openOrderFromNotification])

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.data?.type !== 'ersel:open-order') return
      const orderId = String(event.data.orderId || '')
      if (orderId) openOrderFromNotification(orderId)
    }
    navigator.serviceWorker?.addEventListener('message', onMessage)
    return () => navigator.serviceWorker?.removeEventListener('message', onMessage)
  }, [openOrderFromNotification])

  const nav: { id: AppPage; label: string; icon: typeof Truck }[] = role && isStaffRole(role)
    ? [
        { id: 'desk', label: 'لوحة العمل', icon: ClipboardList },
        { id: 'home', label: 'الموقع', icon: Truck },
        ...(session ? [{ id: 'profile' as const, label: 'ملفي', icon: UserRound }] : [])
      ]
    : [
        { id: 'home', label: 'الرئيسية', icon: Truck },
        { id: 'orders', label: 'طلباتي', icon: ClipboardList },
        { id: 'courier', label: 'للموصّلين', icon: Bike },
        ...(session ? [{ id: 'profile' as const, label: 'ملفي', icon: UserRound }] : []),
        ...(!session ? [{ id: 'track' as const, label: 'تتبع طلب', icon: Search }] : [])
      ]
  const roleLabels = ROLE_LABELS
  const go = (p: typeof page) => {
    setIsMenuOpen(false)
    setNotice('')
    if (window.location.hash.startsWith('#track=')) {
      history.replaceState(null, '', window.location.pathname + window.location.search)
    }
    setPage(p)
  }

  function onBrandClick() {
    if (logoTapTimer.current) window.clearTimeout(logoTapTimer.current)
    const next = logoTaps.current + 1
    logoTaps.current = next
    logoTapTimer.current = window.setTimeout(() => {
      logoTaps.current = 0
      logoTapTimer.current = null
    }, ADMIN_TAP_WINDOW_MS)
    if (next >= 4) {
      logoTaps.current = 0
      if (logoTapTimer.current) window.clearTimeout(logoTapTimer.current)
      logoTapTimer.current = null
      setShowAdminGate(true)
      return
    }
    if (next === 1 && page !== 'admin') go('home')
  }

  async function unlockAdmin(pin: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const unlocked = await unlockAdminWithCode(pin)
    if (!unlocked.ok) return unlocked
    const access = await verifyAdminAccess()
    if (!access.ok) {
      return { ok: false, error: access.error }
    }
    applyVerifiedProfile(access.profile)
    setShowAdminGate(false)
    setAdminUnlocked(true)
    setPage('admin')
    return { ok: true }
  }

  /**
   * Read-only dashboard opened by the admin code alone.
   * No session and no admin role are required, and the code is kept in memory
   * only — never in localStorage, the URL or a cookie.
   */
  async function openCodeDesk(pin: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const result = await fetchCodeDesk(pin)
    if (!result.ok) return { ok: false, error: result.error }
    setShowAdminGate(false)
    setCodeDesk({ code: pin, data: result.data })
    return { ok: true }
  }

  if (authStatus === 'loading' || (authStatus === 'ready' && !minSplash)) {
    return <Splash />
  }
  if (authStatus === 'error') {
    return <Splash error={authError || 'تعذّر الاتصال بالخدمة. تحقّق من الشبكة.'} onRetry={retryAuth} />
  }
  if (!onboardingDone) {
    return <Onboarding onFinish={() => {
      localStorage.setItem(ONBOARDING_KEY, '1')
      setOnboardingDone(true)
    }} />
  }
  if (codeDesk) {
    return (
      <div className="app-immersive">
        <Suspense fallback={<div className="empty-state">جارٍ فتح لوحة الطلبات…</div>}>
          <CodeDesk
            code={codeDesk.code}
            initial={codeDesk.data}
            onExit={() => setCodeDesk(null)}
          />
        </Suspense>
      </div>
    )
  }
  if (session && (profileStatus === 'loading' || profileStatus === 'idle')) {
    return <Splash />
  }
  if (session && (profileStatus === 'missing' || profileStatus === 'error')) {
    return (
      <Splash
        error={profileError || 'تعذّر تحميل الملف الشخصي. لم يتم تسجيل خروجك.'}
        onRetry={() => { void retryProfile() }}
      />
    )
  }
  if (!session && !guest) {
    return <>
      <AuthScreen
        onDone={(nextRole) => {
          setLastRoutedUser(null)
          if (!nextRole) return
          setGuest(true)
          setPage(homePageForRole(nextRole))
        }}
        onGuest={() => setGuest(true)}
        onCodeDesk={() => setShowAdminGate(true)}
      />
      {showAdminGate && (
        <AdminGate
          onClose={() => setShowAdminGate(false)}
          onUnlock={unlockAdmin}
          onReadOnly={openCodeDesk}
        />
      )}
    </>
  }
  if (!session && page === 'orders') {
    return <AuthScreen
      initialMode="login"
      reason="سجّل الدخول لمتابعة طلباتك المحفوظة في حسابك."
      onDone={(nextRole) => {
        setLastRoutedUser(null)
        setPage(nextRole && isStaffRole(nextRole) ? homePageForRole(nextRole) : 'orders')
      }}
      onGuest={() => setPage('home')}
      onCodeDesk={() => setShowAdminGate(true)}
    />
  }

  const immersiveOrder = page === 'new'
  const immersiveDesk = page === 'desk' && !!profile && isStaffRole(profile.role)

  if (immersiveOrder) {
    return (
      <div className="app-immersive">
        <Suspense fallback={<div className="empty-state">جارٍ تحضير الخريطة…</div>}>
        <QuickOrder
          profile={profile}
          isAuthenticated={!!session}
          initialService={selectedService}
          onBack={() => go('home')}
          onSuccess={() => {
            setNotice('تم تسجيل الطلب. سيصل إلى الموصّلين المتاحين.')
            go('orders')
          }}
          onRequireLogin={() => setGuest(false)}
        />
        </Suspense>
        {showAdminGate && (
          <AdminGate
            onClose={() => setShowAdminGate(false)}
            onUnlock={unlockAdmin}
            onReadOnly={openCodeDesk}
          />
        )}
        {notice && <div className="toast" role="status"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="إغلاق"><X size={17}/></button></div>}
      </div>
    )
  }

  if (immersiveDesk) {
    return (
      <div className="app-immersive">
        <Suspense fallback={<div className="empty-state">جارٍ تحميل لوحة العمل…</div>}>
          <EmployeeDesk
            profile={profile!}
            onBack={() => go('home')}
            focusOrderId={focusOrderId}
            onFocusHandled={clearFocus}
            refreshKey={deskRefreshKey}
            unread={unreadNotifications}
            onUnreadChange={setUnreadNotifications}
            onOpenProfile={() => go('profile')}
            onOpenOrder={openOrderFromNotification}
          />
        </Suspense>
        {showAdminGate && (
          <AdminGate
            onClose={() => setShowAdminGate(false)}
            onUnlock={unlockAdmin}
            onReadOnly={openCodeDesk}
          />
        )}
        {notice && <div className="toast" role="status"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="إغلاق"><X size={17}/></button></div>}
      </div>
    )
  }

  return <div className="app-shell">
    <header className="topbar">
      <button className="icon-button mobile-menu" aria-label="فتح القائمة" onClick={() => setIsMenuOpen(!isMenuOpen)}>{isMenuOpen ? <X/> : <Menu/>}</button>
      <button className="brand" onClick={onBrandClick} aria-label="ERSEL home">
        <span className="brand-mark"><img src="/brand/logo-mark.webp" alt="ERSEL" /></span><span><b>ERSEL</b><small>كلش يجي لعندك</small></span>
      </button>
      <nav className={isMenuOpen ? 'nav open' : 'nav'}>
        {nav.map(item => <button key={item.id} className={page===item.id?'nav-link active':'nav-link'} onClick={() => go(item.id)}><item.icon size={17}/>{item.label}</button>)}
      </nav>
      {isAndroidDevice && (
        <button
          className="android-download"
          type="button"
          onClick={openApkSheet}
          aria-label="تحميل تطبيق ERSEL للأندرويد"
        >
          <Download size={17} /><span>{hasApkLink ? 'تحميل APK' : 'تثبيت التطبيق'}</span>
        </button>
      )}
      {session ? (
        <>
          <NotificationBell
            unread={unreadNotifications}
            onUnreadChange={setUnreadNotifications}
            onOpenOrder={openOrderFromNotification}
          />
          <div className="account-chip">
            <button className="account-open" onClick={() => go('profile')} aria-label="الملف الشخصي">
              <span className="account-avatar">
                {profile?.avatar_url
                  ? <img src={profile.avatar_url} alt="" />
                  : <UserRound size={16} />}
              </span>
              <span className="account-text"><b>{profile?.full_name || 'حسابي'}</b><small>{role ? roleLabels[role] : '...'}</small></span>
            </button>
            <button className="account-logout" aria-label="تسجيل الخروج" onClick={() => { void signOut(); setLastRoutedUser(null); setAdminUnlocked(false); setPage('home'); setGuest(false) }}><LogOut size={16} /></button>
          </div>
        </>
      ) : (
        <button className="login-button" onClick={() => setGuest(false)}><LogIn size={17}/> دخول</button>
      )}
    </header>

    <main>
      {page === 'home' && <>
        <section className="hero">
          <div className="hero-copy">
            <span className="eyebrow"><span className="dot"/> خدمة توصيل محلية · ولاية تيارت — بلدية السوقر</span>
            <h1>من عندهم<br/><em>حتى لعندك.</em></h1>
            <p>طعام، طرود، مشتريات وطلبات الأعمال داخل بلدية السوقر. حدّد الانطلاق والوصول على الخريطة ثم اقترح السعر.</p>
            <span className="slogan">كلش يجي لعندك</span>
            <div className="hero-actions"><button className="primary-button" onClick={() => go('new')}>اطلب على الخريطة <ArrowLeft size={18}/></button><button className="text-button" onClick={() => go('courier')}>أريد العمل كموصّل <ChevronLeft size={18}/></button></div>
            <div className="hero-stats"><div><b>4</b><span>خدمات أساسية</span></div><div><b>2</b><span>وسائل توصيل</span></div><div><b>24/7</b><span>هدفنا المستقبلي</span></div></div>
          </div>
          <div className="hero-art">
            <div className="hero-visual">
              <span className="hv-glow hv-glow-a" /><span className="hv-glow hv-glow-b" />
              <div className="hv-mark"><img src="/brand/logo-mark.webp" alt="" /></div>
              <div className="hv-chip chip-a"><PackageCheck size={16}/> من الباب للباب</div>
              <div className="hv-chip chip-b"><ShoppingBag size={16}/> اشريلي</div>
              <div className="hv-chip chip-c"><Wallet size={16}/> السعر بالاتفاق</div>
              <div className="hv-route" />
            </div>
          </div>
        </section>

        <section className="section">
          <div className="section-heading"><div><span className="eyebrow">خدماتنا</span><h2>كل ما تحتاجه، في طلب واحد</h2></div><span className="muted">اختار الخدمة المناسبة</span></div>
          <div className="service-grid">{services.map((s, i) => <button className="service-card" key={s.id} onClick={() => {setSelectedService(s.id); go('new')}}><span className={`service-icon color-${i}`}><s.icon size={25}/></span><b>{s.title}</b><span>{s.subtitle}</span><span className="service-arrow"><ArrowLeft size={17}/></span></button>)}</div>
        </section>

        <section className="section coverage">
          <div className="section-heading"><div><span className="eyebrow">منطقة الخدمة</span><h2>وين نخدم حالياً؟</h2></div><span className="muted">نتوسّع تدريجياً</span></div>
          <div className="coverage-grid">
            <div className="coverage-card active"><span className="coverage-badge">متاح الآن</span><b>ولاية تيارت</b><span>بلدية السوقر</span></div>
            <div className="coverage-card soon"><span className="coverage-badge">قريباً</span><b>باقي الولايات</b><span>نعمل على التوسّع خطوة بخطوة</span></div>
          </div>
        </section>

        {isAndroidDevice && (
          <section className="apk-promo">
            <span className="apk-promo-icon"><Smartphone size={26} /></span>
            <div>
              <span className="eyebrow">تطبيق أندرويد</span>
              <h2>ثبّت ERSEL على هاتفك</h2>
              <p>نفس حسابك ونفس طلباتك، بأيقونة على الشاشة الرئيسية وإشعارات بصوت مخصّص عند كل تحديث.</p>
            </div>
            <button className="light-button" onClick={openApkSheet}>
              <Download size={17} /> {hasApkLink ? 'تحميل APK' : 'كيف أثبّته؟'}
            </button>
          </section>
        )}

        <section className="partner-banner"><div className="partner-icon"><Bike size={34}/></div><div><span className="eyebrow">فرصتك تبدأ هنا</span><h2>عندك دراجة أو سيارة؟</h2><p>انضم إلى شبكة ERSEL وابدأ استقبال طلبات التوصيل بعد التحقق من حسابك.</p></div><button className="light-button" onClick={() => go('courier')}>سجّل كموصّل <ArrowLeft size={18}/></button></section>
        <section className="steps section"><div className="section-heading"><div><span className="eyebrow">بكل سهولة</span><h2>كيف تعمل ERSEL؟</h2></div></div><div className="step-grid">{[{n:'01',t:'اختار الخدمة',d:'حدّد نوع الطلب الذي تحتاجه.'},{n:'02',t:'أدخل العناوين',d:'اكتب مكان الاستلام والتسليم بوضوح.'},{n:'03',t:'تأكيد ومتابعة',d:'تُدار الطلبات عبر النظام بعد ربط الموصّلين.'}].map(s=><div className="step-card" key={s.n}><span>{s.n}</span><h3>{s.t}</h3><p>{s.d}</p></div>)}</div></section>
      </>}

      {page === 'track' && <TrackOrder initialToken={trackToken} onBack={() => go('home')} />}

      {page === 'desk' && (
        <section className="page-section narrow"><span className="eyebrow">لوحة العمل</span><h1 className="page-title">وصول مقيّد</h1><p className="muted">هذه الصفحة للموظفين المعتمدين فقط.</p><button className="primary-button" onClick={() => go('home')}>العودة</button></section>
      )}

      {page === 'orders' && (
        <MyOrders
          onNewOrder={() => go('new')}
          viewerId={userId}
          focusOrderId={focusOrderId}
          onFocusHandled={clearFocus}
          refreshKey={deskRefreshKey}
        />
      )}

      {page === 'profile' && profile && (
        <ProfilePage
          profile={profile}
          onProfileChange={(next: Profile) => applyVerifiedProfile(next)}
          onBack={() => go(homePageForRole(profile.role))}
          onOpenOrder={orderId => { setFocusOrderId(orderId); go('orders') }}
          onSignOut={() => {
            void signOut()
            setLastRoutedUser(null)
            setAdminUnlocked(false)
            setPage('home')
            setGuest(false)
          }}
        />
      )}

      {page === 'courier' && (
        <CourierApply
          profile={profile}
          isAuthenticated={!!session}
          onBack={() => go('home')}
          onRequireLogin={() => setGuest(false)}
        />
      )}

      {page === 'admin' && adminUnlocked && profile?.role === 'admin' && (
        <Suspense fallback={<div className="empty-state">جارٍ تحميل لوحة الإدارة…</div>}>
          <AdminDesk profile={profile} onExit={() => { setAdminUnlocked(false); go('home') }} />
        </Suspense>
      )}
      {page === 'admin' && (!adminUnlocked || profile?.role !== 'admin') && (
        <section className="page-section narrow">
          <span className="eyebrow">لوحة الإدارة</span>
          <h1 className="page-title">وصول مقيّد</h1>
          <p className="muted">
            {!session
              ? 'لا توجد جلسة صالحة. سجّل الدخول أولًا ثم أدخل رمز الإدارة.'
              : profileStatus === 'missing'
                ? 'الحساب مسجّل لكن الملف الشخصي غير موجود في قاعدة البيانات.'
                : profileStatus === 'error'
                  ? (profileError || 'تعذّر قراءة صلاحية الحساب من قاعدة البيانات.')
                  : profile?.role && profile.role !== 'admin'
                    ? 'هذا الحساب لا يملك دور المدير. الرمز لا يمنح الدور.'
                    : 'الدخول يتطلب جلسة صحيحة ودور مدير معتمد من قاعدة البيانات. الرمز لا يمنح الدور.'}
          </p>
          <button className="primary-button" onClick={() => go('home')}>العودة</button>
        </section>
      )}
    </main>
    {showAdminGate && (
      <AdminGate
        onClose={() => setShowAdminGate(false)}
        onUnlock={unlockAdmin}
        onReadOnly={openCodeDesk}
      />
    )}
    {showApkSheet && <AndroidInstall onClose={closeApkSheet} />}

    {notice && <div className="toast" role="status"><span>{notice}</span><button onClick={()=>setNotice('')} aria-label="إغلاق"><X size={17}/></button></div>}
    <footer><div className="footer-brand"><span className="brand-mark"><img src="/brand/logo-mark.webp" alt="" /></span><b>ERSEL</b></div><span>كلش يجي لعندك</span><span>© {new Date().getFullYear()} ERSEL · ولاية تيارت — بلدية السوقر</span></footer>
  </div>
}
