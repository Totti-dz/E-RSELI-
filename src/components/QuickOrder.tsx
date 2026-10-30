import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, Bike, CheckCircle2, Copy, Info, Loader2, MapPin, Phone,
  ReceiptText, ShieldCheck, UserRound, WifiOff, AlertTriangle, Car, ChevronUp, ChevronDown, LocateFixed
} from 'lucide-react'
import { normalizePhone, type Profile } from '../lib/auth'
import { SERVICES, type ServiceId, serviceTitle } from '../lib/services'
import {
  getOrderCapabilities, submitAccountOrder, submitGuestOrder,
  type OrderCapabilities, type OrderDraft
} from '../lib/orders'
import { SERVICE_AREA, isInsideServiceArea, ROUTING_ENABLED, haversineMeters, type LatLng } from '../lib/geo/config'
import { describePoint, formatCoords, type Place } from '../lib/geo/places'
import { fetchDrivingRoute, formatDistance } from '../lib/geo/routing'
import { suggestPriceFromRouteMeters } from '../lib/pricing'
import OrderMap, { type MapTarget } from './OrderMap'
import PlaceField from './PlaceField'

type Props = {
  profile: Profile | null
  isAuthenticated: boolean
  initialService?: ServiceId
  onSuccess: (orderId: string) => void
  onRequireLogin: () => void
  onBack?: () => void
}

type FormErrors = Partial<Record<
  'phone' | 'pickup' | 'dropoff' | 'map' | 'details' | 'notes' | 'price' | 'submit', string
>>

type SheetStep = 'route' | 'details' | 'review'

const formatDzd = (amount: number) => `${new Intl.NumberFormat('fr-DZ').format(amount)} دج`
const toLocalPhone = (e164: string) => e164.replace(/^\+213/, '0')

function priceToNumber(raw: string): number | null {
  const digits = raw.replace(/[^\d]/g, '')
  if (!digits) return null
  const value = Number(digits)
  return Number.isSafeInteger(value) ? value : null
}

export default function QuickOrder({ profile, isAuthenticated, initialService = 'parcel', onSuccess, onRequireLogin, onBack }: Props) {
  const [contactMode, setContactMode] = useState<'account' | 'other'>('account')
  const [accountPhone, setAccountPhone] = useState('')
  const [otherPhone, setOtherPhone] = useState('')
  const [guestPhone, setGuestPhone] = useState('')

  const [service, setService] = useState<ServiceId>(initialService)
  const [pickupText, setPickupText] = useState('')
  const [dropoffText, setDropoffText] = useState('')
  const [pickup, setPickup] = useState<LatLng | null>(null)
  const [dropoff, setDropoff] = useState<LatLng | null>(null)
  const [activeTarget, setActiveTarget] = useState<MapTarget>('pickup')
  const [details, setDetails] = useState('')
  const [notes, setNotes] = useState('')
  const [vehicle, setVehicle] = useState<'motorcycle' | 'car'>('motorcycle')
  const [price, setPrice] = useState('')

  const [errors, setErrors] = useState<FormErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [capabilities, setCapabilities] = useState<OrderCapabilities | null>(null)
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))
  const [mapFailed, setMapFailed] = useState(false)
  const [guestTicket, setGuestTicket] = useState<{ code: string; token: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [sheetStep, setSheetStep] = useState<SheetStep>('route')
  const [sheetOpen, setSheetOpen] = useState(true)
  const [locateError, setLocateError] = useState('')
  const [locating, setLocating] = useState(false)
  const [routeDistanceM, setRouteDistanceM] = useState<number | null>(null)
  const [routeHint, setRouteHint] = useState('')

  const submittingRef = useRef(false)
  const formRef = useRef<HTMLFormElement | null>(null)

  const accountE164 = useMemo(() => {
    if (!profile?.phone) return ''
    const result = normalizePhone(profile.phone)
    return result.ok ? result.e164 : ''
  }, [profile?.phone])

  useEffect(() => {
    setAccountPhone(accountE164)
  }, [accountE164])

  useEffect(() => {
    let alive = true
    getOrderCapabilities().then(result => {
      if (alive) setCapabilities(result)
    })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    const goOnline = () => setOnline(true)
    const goOffline = () => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  useEffect(() => {
    if (!ROUTING_ENABLED || !pickup || !dropoff) {
      setRouteDistanceM(null)
      setRouteHint('')
      return
    }
    let alive = true
    fetchDrivingRoute(pickup, dropoff).then(result => {
      if (!alive) return
      if (result.ok) {
        setRouteDistanceM(result.distanceM)
        setRouteHint('')
      } else {
        setRouteDistanceM(null)
        setRouteHint(result.error)
      }
    })
    return () => { alive = false }
  }, [pickup, dropoff])

  const contactE164 = useMemo(() => {
    if (!isAuthenticated) return normalizePhone(guestPhone)
    if (contactMode === 'account') {
      if (!accountPhone) return { ok: false as const, error: 'لا يوجد رقم هاتف في حسابك. اختر «رقم هاتف آخر» وأدخله.' }
      return { ok: true as const, e164: accountPhone }
    }
    return normalizePhone(otherPhone)
  }, [isAuthenticated, guestPhone, contactMode, accountPhone, otherPhone])

  const numericPrice = priceToNumber(price)
  const pickupInside = pickup ? isInsideServiceArea(pickup, SERVICE_AREA) : null
  const dropoffInside = dropoff ? isInsideServiceArea(dropoff, SERVICE_AREA) : null
  const suggestedPrice = routeDistanceM != null ? suggestPriceFromRouteMeters(routeDistanceM) : null
  const straightMeters = pickup && dropoff ? haversineMeters(pickup, dropoff) : null

  function choosePlace(target: MapTarget, place: Place) {
    if (target === 'pickup') {
      setPickup({ lat: place.lat, lng: place.lng })
      setPickupText(place.nameAr)
      setActiveTarget('dropoff')
      setErrors(current => ({ ...current, pickup: undefined, map: undefined }))
    } else {
      setDropoff({ lat: place.lat, lng: place.lng })
      setDropoffText(place.nameAr)
      setErrors(current => ({ ...current, dropoff: undefined, map: undefined }))
    }
  }

  function handleMapPick(point: LatLng, target: MapTarget) {
    if (target === 'pickup') {
      setPickup(point)
      if (!pickupText.trim()) setPickupText(describePoint(point))
      setErrors(current => ({ ...current, pickup: undefined, map: undefined }))
      // After the first tap, the next map tap should choose the destination
      // instead of silently moving the pickup point again.
      if (!dropoff) setActiveTarget('dropoff')
    } else {
      setDropoff(point)
      if (!dropoffText.trim()) setDropoffText(describePoint(point))
      setErrors(current => ({ ...current, dropoff: undefined, map: undefined }))
    }
  }

  function locateMe() {
    if (!navigator.geolocation) {
      setLocateError('المتصفح لا يدعم تحديد الموقع.')
      return
    }
    setLocating(true)
    setLocateError('')
    navigator.geolocation.getCurrentPosition(
      position => {
        setLocating(false)
        const point = { lat: position.coords.latitude, lng: position.coords.longitude }
        if (!isInsideServiceArea(point, SERVICE_AREA)) {
          setLocateError('موقعك الحالي خارج نطاق السوقر (8 كم من المركز). حدّد نقطة داخل البلدية على الخريطة.')
          return
        }
        handleMapPick(point, activeTarget)
        if (activeTarget === 'pickup' && !pickupText.trim()) setPickupText('موقعي الحالي')
        if (activeTarget === 'dropoff' && !dropoffText.trim()) setDropoffText('موقعي الحالي')
      },
      () => {
        setLocating(false)
        setLocateError('تعذّر الحصول على الموقع. اسمح بالصلاحية أو حدّد النقطة على الخريطة.')
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 20000 }
    )
  }

  function validateRoute(): FormErrors {
    const next: FormErrors = {}
    if (pickupText.trim().length < 3) next.pickup = 'اكتب عنوان الانطلاق (3 أحرف على الأقل).'
    if (dropoffText.trim().length < 3) next.dropoff = 'اكتب عنوان الوصول (3 أحرف على الأقل).'
    if (!pickup) next.map = 'حدّد نقطة الانطلاق على الخريطة أو من الاقتراحات.'
    else if (pickupInside === false) next.pickup = 'نقطة الانطلاق خارج نطاق الخدمة الحالي (بلدية السوقر، ضمن 8 كم من المركز).'
    if (!dropoff) next.map = next.map || 'حدّد نقطة الوصول على الخريطة أو من الاقتراحات.'
    else if (dropoffInside === false) next.dropoff = 'نقطة الوصول خارج نطاق الخدمة الحالي (بلدية السوقر، ضمن 8 كم من المركز).'
    return next
  }

  function validate(): FormErrors {
    const next = validateRoute()
    if (!contactE164.ok) next.phone = contactE164.error
    if (details.trim().length < 3) next.details = 'اكتب وصفاً قصيراً للطلب (3 أحرف على الأقل).'
    if (details.trim().length > 1000) next.details = 'الوصف طويل جداً (الحد 1000 حرف).'
    if (notes.trim().length > 500) next.notes = 'الملاحظات طويلة جداً (الحد 500 حرف).'
    if (numericPrice === null) next.price = 'أدخل السعر المقترح بالدينار.'
    else if (numericPrice < 100) next.price = 'أقل سعر للتوصيل هو 100 دج.'
    else if (numericPrice > 500000) next.price = 'السعر المقترح مرتفع جداً. تحقّق من القيمة.'
    return next
  }

  function goDetails() {
    const found = validateRoute()
    if (Object.keys(found).length) {
      setErrors(found)
      setSheetOpen(true)
      return
    }
    setErrors({})
    setSheetStep('details')
    setSheetOpen(true)
  }

  function goReview() {
    const found = validate()
    const relevant: FormErrors = {}
    if (found.phone) relevant.phone = found.phone
    if (found.details) relevant.details = found.details
    if (found.notes) relevant.notes = found.notes
    if (found.price) relevant.price = found.price
    if (Object.keys(relevant).length) {
      setErrors(relevant)
      setSheetOpen(true)
      return
    }
    setErrors({})
    setSheetStep('review')
    setSheetOpen(true)
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (submittingRef.current) return
    setErrors({})
    if (!online) {
      setErrors({ submit: 'لا يوجد اتصال بالإنترنت. تحقّق من الشبكة ثم أعد المحاولة.' })
      return
    }
    const found = validate()
    if (Object.keys(found).length) {
      setErrors(found)
      if (found.pickup || found.dropoff || found.map) setSheetStep('route')
      else if (found.phone || found.details || found.notes || found.price) setSheetStep('details')
      setSheetOpen(true)
      return
    }
    if (!contactE164.ok || !pickup || !dropoff || numericPrice === null) return

    const extraNotes = notes.trim()
    const canStoreNotes = capabilities?.notes === true
    const draft: OrderDraft = {
      service,
      phoneE164: contactE164.e164,
      customerName: profile?.full_name || '',
      pickupText: pickupText.trim(),
      dropoffText: dropoffText.trim(),
      pickup,
      dropoff,
      details: extraNotes && !canStoreNotes
        ? `${details.trim()}\n\nملاحظات: ${extraNotes}`
        : details.trim(),
      notes: canStoreNotes ? extraNotes : '',
      vehicle,
      priceDzd: numericPrice
    }

    submittingRef.current = true
    setSubmitting(true)
    try {
      const result = isAuthenticated && profile
        ? await submitAccountOrder(draft, profile.id)
        : await submitGuestOrder(draft)

      if (!result.ok) {
        setErrors({ submit: result.error })
        return
      }
      setSubmitted(true)
      if (result.kind === 'guest') {
        setGuestTicket({ code: result.orderCode, token: result.trackingToken })
      } else {
        onSuccess(result.orderId)
      }
    } catch {
      setErrors({ submit: 'تعذّر إرسال الطلب بسبب خطأ غير متوقع. أعد المحاولة.' })
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  async function copyToken() {
    if (!guestTicket) return
    try {
      const link = `${window.location.origin}${window.location.pathname}#track=${guestTicket.token}`
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2200)
    } catch {
      setCopied(false)
    }
  }

  if (submitted && guestTicket) {
    return (
      <section className="page-section narrow">
        <div className="order-success">
          <span className="success-icon"><CheckCircle2 size={34} /></span>
          <h1>تم حفظ طلبك</h1>
          <p>احتفظ برمز التتبع التالي. هو الوسيلة الوحيدة لمتابعة الطلب دون حساب.</p>
          <div className="ticket-row">
            <span>رقم الطلب</span>
            <b>{guestTicket.code}</b>
          </div>
          <div className="ticket-token">
            <span>رمز التتبع</span>
            <code>{guestTicket.token}</code>
          </div>
          <button type="button" className="secondary-button" onClick={copyToken}>
            <Copy size={16} /> {copied ? 'تم النسخ' : 'نسخ رابط التتبع'}
          </button>
          <p className="ticket-warning">
            <ShieldCheck size={15} /> لا تشارك رمز التتبع علناً: من يملكه يستطيع رؤية حالة الطلب.
          </p>
          <button
            type="button"
            className="primary-button full"
            onClick={() => { window.location.hash = `track=${guestTicket.token}` }}
          >
            متابعة الطلب <ArrowLeft size={18} />
          </button>
        </div>
      </section>
    )
  }

  const showCoordsNotice = capabilities?.coordinates === false
  const canContinueRoute = pickup && dropoff && pickupInside !== false && dropoffInside !== false
    && pickupText.trim().length >= 3 && dropoffText.trim().length >= 3

  return (
    <div className="ride-shell">
      <div className="ride-map" id="order-map-anchor">
        <OrderMap
          pickup={pickup}
          dropoff={dropoff}
          active={activeTarget}
          onPick={handleMapPick}
          onTileError={() => setMapFailed(true)}
          variant="full"
          sheetPadding
        />
      </div>

      <header className="ride-top">
        {onBack && (
          <button type="button" className="ride-icon-btn" onClick={onBack} aria-label="رجوع">
            <ArrowLeft size={18} />
          </button>
        )}
        <div className="ride-brand">
          <img src="/brand/logo-mark.webp" alt="ERSEL" />
          <span>
            <b>ERSEL</b>
            <small>السوقر · تيارت</small>
          </span>
        </div>
        <button
          type="button"
          className="ride-icon-btn"
          onClick={locateMe}
          disabled={locating}
          aria-label="موقعي الحالي"
        >
          {locating ? <Loader2 size={18} className="spin" /> : <LocateFixed size={18} />}
        </button>
      </header>

      <div className="ride-map-chip">
        <span className={`place-dot ${activeTarget}`} />
        انقر لتحديد {activeTarget === 'pickup' ? 'الانطلاق' : 'الوصول'}
      </div>

      {mapFailed && (
        <div className="ride-toast warning" role="alert">
          <AlertTriangle size={16} /> تعذّر تحميل بلاطات الخريطة.
          <button type="button" onClick={() => setMapFailed(false)}>إخفاء</button>
        </div>
      )}
      {locateError && (
        <div className="ride-toast warning" role="alert">
          <AlertTriangle size={16} /> {locateError}
          <button type="button" onClick={() => setLocateError('')}>إخفاء</button>
        </div>
      )}

      <form className={sheetOpen ? 'ride-sheet open' : 'ride-sheet'} onSubmit={handleSubmit} ref={formRef} noValidate>
        <button
          type="button"
          className="sheet-handle"
          aria-label={sheetOpen ? 'طي الورقة' : 'فتح الورقة'}
          onClick={() => setSheetOpen(open => !open)}
        >
          {sheetOpen ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
        </button>

        <div className="sheet-steps" aria-label="خطوات الطلب">
          <span className={sheetStep === 'route' ? 'on' : ''}>المسار</span>
          <span className={sheetStep === 'details' ? 'on' : ''}>التفاصيل</span>
          <span className={sheetStep === 'review' ? 'on' : ''}>المراجعة</span>
        </div>

        {!online && (
          <div className="inline-alert warning" role="alert">
            <WifiOff size={18} /> لا يوجد اتصال. الإرسال معطّل حتى تعود الشبكة.
          </div>
        )}
        {!isAuthenticated && sheetStep === 'route' && (
          <div className="inline-alert info">
            <Info size={18} />
            تطلب كضيف. المتابعة برمز التتبع فقط.
            <button type="button" onClick={onRequireLogin}>تسجيل الدخول</button>
          </div>
        )}

        {sheetStep === 'route' && (
          <div className="sheet-body">
            <PlaceField
              compact
              field="pickup"
              label="من أين نأخذ الطلب؟"
              placeholder="حي، شارع، أو علامة في السوقر"
              value={pickupText}
              point={pickup}
              error={errors.pickup}
              active={activeTarget === 'pickup'}
              onChange={setPickupText}
              onChoose={place => choosePlace('pickup', place)}
              onFocusField={() => setActiveTarget('pickup')}
              onClearPoint={() => setPickup(null)}
              onActivateMap={() => setActiveTarget('pickup')}
            />
            <PlaceField
              compact
              field="dropoff"
              label="إلى أين نوصّل؟"
              placeholder="حي، شارع، أو علامة في السوقر"
              value={dropoffText}
              point={dropoff}
              error={errors.dropoff}
              active={activeTarget === 'dropoff'}
              onChange={setDropoffText}
              onChoose={place => choosePlace('dropoff', place)}
              onFocusField={() => setActiveTarget('dropoff')}
              onClearPoint={() => setDropoff(null)}
              onActivateMap={() => setActiveTarget('dropoff')}
            />
            {errors.map && <p className="field-error">{errors.map}</p>}
            {pickup && !pickupInside && <p className="field-error">الانطلاق خارج نطاق السوقر (8 كم).</p>}
            {dropoff && !dropoffInside && <p className="field-error">الوصول خارج نطاق السوقر (8 كم).</p>}
            {routeDistanceM != null && (
              <p className="sheet-meta">مسافة المسار المتاحة: {formatDistance(routeDistanceM)}</p>
            )}
            {!ROUTING_ENABLED && straightMeters != null && (
              <p className="sheet-meta">خط مستقيم تقريبي: {formatDistance(straightMeters)} · مسار القيادة غير مفعّل.</p>
            )}
            {routeHint && <p className="sheet-meta">{routeHint}</p>}
            <button type="button" className="primary-button full" disabled={!canContinueRoute} onClick={goDetails}>
              متابعة <ArrowLeft size={18} />
            </button>
          </div>
        )}

        {sheetStep === 'details' && (
          <div className="sheet-body">
            <div className="service-pills">
              {SERVICES.map(item => (
                <button
                  key={item.id}
                  type="button"
                  className={service === item.id ? 'service-pill selected' : 'service-pill'}
                  onClick={() => setService(item.id)}
                >
                  <item.icon size={15} /> {item.shortTitle}
                </button>
              ))}
            </div>

            <div data-field="phone">
              {isAuthenticated ? (
                <>
                  <div className="contact-options">
                    <button
                      type="button"
                      className={contactMode === 'account' ? 'contact-option selected' : 'contact-option'}
                      onClick={() => setContactMode('account')}
                      aria-pressed={contactMode === 'account'}
                    >
                      <Phone size={17} />
                      <span>
                        <b>رقم حسابي</b>
                        <small dir="ltr">{accountPhone ? toLocalPhone(accountPhone) : 'لا يوجد رقم'}</small>
                      </span>
                    </button>
                    <button
                      type="button"
                      className={contactMode === 'other' ? 'contact-option selected' : 'contact-option'}
                      onClick={() => setContactMode('other')}
                      aria-pressed={contactMode === 'other'}
                    >
                      <UserRound size={17} />
                      <span>
                        <b>رقم آخر</b>
                        <small>لن يتغيّر حسابك</small>
                      </span>
                    </button>
                  </div>
                  {contactMode === 'other' && (
                    <label className="field">
                      <span>رقم الهاتف البديل</span>
                      <input type="tel" inputMode="tel" dir="ltr" value={otherPhone} onChange={event => setOtherPhone(event.target.value)} placeholder="05 / 06 / 07..." aria-invalid={!!errors.phone} />
                      {errors.phone && <small className="field-error">{errors.phone}</small>}
                    </label>
                  )}
                  {contactMode === 'account' && errors.phone && <p className="field-error">{errors.phone}</p>}
                </>
              ) : (
                <label className="field">
                  <span>رقم هاتف للتواصل</span>
                  <input type="tel" inputMode="tel" dir="ltr" value={guestPhone} onChange={event => setGuestPhone(event.target.value)} placeholder="0551234567" aria-invalid={!!errors.phone} />
                  {errors.phone && <small className="field-error">{errors.phone}</small>}
                </label>
              )}
            </div>

            <label className="field" data-field="details">
              <span>وصف الطلب</span>
              <textarea rows={3} value={details} maxLength={1000} onChange={event => setDetails(event.target.value)} placeholder="مثال: طرد صغير، أو طلب من مطعم..." aria-invalid={!!errors.details} />
              <small className="field-hint">{details.length}/1000</small>
              {errors.details && <small className="field-error">{errors.details}</small>}
            </label>
            <label className="field">
              <span>ملاحظات (اختياري)</span>
              <textarea rows={2} value={notes} maxLength={500} onChange={event => setNotes(event.target.value)} placeholder="الطابق، لون الباب، اسم المحل..." aria-invalid={!!errors.notes} />
              {errors.notes && <small className="field-error">{errors.notes}</small>}
            </label>
            <div className="vehicle-options">
              <button type="button" className={vehicle === 'motorcycle' ? 'vehicle-option selected' : 'vehicle-option'} onClick={() => setVehicle('motorcycle')}>
                <Bike size={17} /> دراجة
              </button>
              <button type="button" className={vehicle === 'car' ? 'vehicle-option selected' : 'vehicle-option'} onClick={() => setVehicle('car')}>
                <Car size={17} /> سيارة
              </button>
            </div>
            <label className="field" data-field="price">
              <span>السعر المقترح (دج)</span>
              <div className="price-input">
                <input type="text" inputMode="numeric" value={price} onChange={event => setPrice(event.target.value.replace(/[^\d]/g, '').slice(0, 6))} placeholder="0" aria-invalid={!!errors.price} />
                <span>دج</span>
              </div>
              {suggestedPrice != null && (
                <button type="button" className="suggest-price" onClick={() => setPrice(String(suggestedPrice))}>
                  اقتراح من المسافة المتاحة: {formatDzd(suggestedPrice)} — ليس تعريفة معتمدة
                </button>
              )}
              {errors.price
                ? <small className="field-error">{errors.price}</small>
                : <small className="field-hint">أقل سعر 100 دج. السعر قابل للتفاوض، وليس فاتورة نهائية.</small>}
            </label>
            <div className="sheet-nav">
              <button type="button" className="secondary-button" onClick={() => setSheetStep('route')}>رجوع</button>
              <button type="button" className="primary-button" onClick={goReview}>مراجعة <ArrowLeft size={16} /></button>
            </div>
          </div>
        )}

        {sheetStep === 'review' && (
          <div className="sheet-body" data-field="summary">
            <dl className="summary-list">
              <div><dt>الهاتف</dt><dd dir="ltr">{contactE164.ok ? toLocalPhone(contactE164.e164) : '—'}</dd></div>
              <div><dt>الخدمة</dt><dd>{serviceTitle(service)}</dd></div>
              <div><dt>من</dt><dd>{pickupText || '—'}<small>{pickup ? formatCoords(pickup) : 'بدون إحداثيات'}</small></dd></div>
              <div><dt>إلى</dt><dd>{dropoffText || '—'}<small>{dropoff ? formatCoords(dropoff) : 'بدون إحداثيات'}</small></dd></div>
              <div><dt>الوسيلة</dt><dd>{vehicle === 'car' ? 'سيارة' : 'دراجة نارية'}</dd></div>
              <div><dt>السعر المقترح</dt><dd><b>{numericPrice ? formatDzd(numericPrice) : '—'}</b></dd></div>
              <div><dt>الدفع</dt><dd>عند التسليم أو بالاتفاق</dd></div>
            </dl>
            {showCoordsNotice && (
              <p className="summary-note">
                <ReceiptText size={15} /> سيُحفظ العنوان النصي؛ الإحداثيات تنتظر تحديث قاعدة البيانات المقترح.
              </p>
            )}
            {!isAuthenticated && capabilities?.guestOrders === false && (
              <p className="summary-note warning">
                <AlertTriangle size={15} /> إرسال الضيف يحتاج دالة الخادم. سجّل الدخول للإرسال الآن.
              </p>
            )}
            {errors.submit && (
              <div className="inline-alert danger" role="alert">
                <AlertTriangle size={18} /> {errors.submit}
              </div>
            )}
            <div className="sheet-nav">
              <button type="button" className="secondary-button" onClick={() => setSheetStep('details')}>تعديل</button>
              <button className="primary-button" type="submit" disabled={submitting || !online}>
                {submitting ? <><Loader2 size={18} className="spin" /> جارٍ الإرسال…</> : <>تأكيد الطلب <ArrowLeft size={18} /></>}
              </button>
            </div>
            <p className="submit-hint"><MapPin size={14} /> التأكيد يرسل الطلب للمراجعة، وليس قبول السعر تلقائياً.</p>
          </div>
        )}
      </form>
    </div>
  )
}
