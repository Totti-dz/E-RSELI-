import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, Bike, Car, CheckCircle2, CircleHelp, Clock3, Loader2,
  Phone, ShieldCheck, UserRound, XCircle
} from 'lucide-react'
import { normalizePhone, type Profile } from '../lib/auth'
import {
  loadCourierApplication, submitCourierApplication, validateCourierDraft,
  type ApplicationStatus, type CourierApplication, type VehicleKind
} from '../lib/courierApply'

type Props = {
  profile: Profile | null
  isAuthenticated: boolean
  onRequireLogin: () => void
  onBack: () => void
}

type FormErrors = Partial<Record<'firstName' | 'lastName' | 'phone' | 'age' | 'vehicle' | 'plate' | 'terms' | 'submit', string>>

const STATUS_COPY: Record<ApplicationStatus, { title: string; text: string; icon: typeof Clock3; tone: 'pending' | 'ok' | 'no' }> = {
  pending: {
    title: 'طلبك قيد المراجعة',
    text: 'وصل الطلب إلى الإدارة. لن تتمكن من قبول طلبات التوصيل قبل الاعتماد.',
    icon: Clock3,
    tone: 'pending'
  },
  approved: {
    title: 'تم اعتماد حسابك',
    text: 'يمكنك الدخول إلى لوحة العمل بعد أن يصبح دور الحساب موصّلاً من الإدارة.',
    icon: CheckCircle2,
    tone: 'ok'
  },
  rejected: {
    title: 'لم يُقبل الطلب',
    text: 'يمكنك تصحيح البيانات وإرسال طلب جديد بعد الرفض.',
    icon: XCircle,
    tone: 'no'
  }
}

const SERVICE_CITY = 'السوقر'

function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { first: '', last: '' }
  if (parts.length === 1) return { first: parts[0], last: '' }
  return { first: parts[0], last: parts.slice(1).join(' ') }
}

function toLocalPhone(e164: string): string {
  return e164.replace(/^\+213/, '0')
}

export default function CourierApply({ profile, isAuthenticated, onRequireLogin, onBack }: Props) {
  const nameParts = useMemo(() => splitName(profile?.full_name || ''), [profile?.full_name])
  const accountPhone = useMemo(() => {
    if (!profile?.phone) return ''
    const result = normalizePhone(profile.phone)
    return result.ok ? toLocalPhone(result.e164) : profile.phone
  }, [profile?.phone])

  const [firstName, setFirstName] = useState(nameParts.first)
  const [lastName, setLastName] = useState(nameParts.last)
  const [phone, setPhone] = useState(accountPhone)
  const [age, setAge] = useState('')
  const [vehicle, setVehicle] = useState<VehicleKind>('motorcycle')
  const [vehicleMake, setVehicleMake] = useState('')
  const [vehicleModel, setVehicleModel] = useState('')
  const [vehiclePlate, setVehiclePlate] = useState('')
  const [accepted, setAccepted] = useState(false)
  const [errors, setErrors] = useState<FormErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading] = useState(isAuthenticated)
  const [application, setApplication] = useState<CourierApplication | null>(null)
  const [verified, setVerified] = useState(false)
  const [pendingSql, setPendingSql] = useState(false)
  const submittingRef = useRef(false)

  useEffect(() => {
    setFirstName(current => current || nameParts.first)
    setLastName(current => current || nameParts.last)
  }, [nameParts.first, nameParts.last])

  useEffect(() => {
    if (accountPhone) setPhone(current => current || accountPhone)
  }, [accountPhone])

  useEffect(() => {
    if (!isAuthenticated) {
      setLoading(false)
      return
    }
    let alive = true
    setLoading(true)
    loadCourierApplication().then(result => {
      if (!alive) return
      setLoading(false)
      if (!result.ok) {
        if (result.kind === 'pending_sql') setPendingSql(true)
        else setErrors({ submit: result.error })
        return
      }
      setVerified(result.verified)
      setPendingSql(!result.schemaReady)
      setApplication(result.application)
      if (result.application) {
        setFirstName(result.application.firstName)
        setLastName(result.application.lastName)
        setPhone(toLocalPhone(result.application.phone) || result.application.phone)
        setAge(result.application.ageYears ? String(result.application.ageYears) : '')
        setVehicle(result.application.vehicle)
        setVehicleMake(result.application.vehicleMake)
        setVehicleModel(result.application.vehicleModel)
        setVehiclePlate(result.application.vehiclePlate)
      }
    })
    return () => { alive = false }
  }, [isAuthenticated])

  const locked = application?.status === 'pending' || application?.status === 'approved' || verified
  const canResubmit = application?.status === 'rejected'

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (submittingRef.current || locked) return
    const next: FormErrors = {}
    if (firstName.trim().length < 2) next.firstName = 'أدخل الاسم (حرفان على الأقل).'
    if (lastName.trim().length < 2) next.lastName = 'أدخل اللقب (حرفان على الأقل).'
    const phoneResult = normalizePhone(phone)
    if (!phoneResult.ok) next.phone = phoneResult.error
    const ageYears = Number(age)
    if (!Number.isInteger(ageYears) || ageYears < 18 || ageYears > 80) {
      next.age = 'يجب أن يكون عمرك 18 سنة على الأقل.'
    }
    if (vehicle === 'car' && vehiclePlate.trim().length < 3) {
      next.plate = 'أدخل رقم لوحة المركبة.'
    }
    if (!accepted) next.terms = 'يجب الموافقة على شروط العمل كموصّل.'
    const draft = {
      firstName,
      lastName,
      phone,
      ageYears: Number.isInteger(ageYears) ? ageYears : 0,
      vehicle,
      vehicleMake,
      vehicleModel,
      vehiclePlate,
      city: SERVICE_CITY
    }
    const extra = validateCourierDraft(draft)
    if (extra && !next.firstName && !next.lastName && !next.phone && !next.age && !next.plate) {
      next.submit = extra
    }
    setErrors(next)
    if (Object.keys(next).length) return
    if (!isAuthenticated) {
      onRequireLogin()
      return
    }

    submittingRef.current = true
    setSubmitting(true)
    const result = await submitCourierApplication(draft)
    submittingRef.current = false
    setSubmitting(false)
    if (!result.ok) {
      if (result.kind === 'pending_sql') setPendingSql(true)
      if (result.kind === 'auth') onRequireLogin()
      setErrors({ submit: result.error })
      return
    }
    setPendingSql(false)
    setApplication(current => ({
      firstName: draft.firstName.trim(),
      lastName: draft.lastName.trim(),
      phone: phoneResult.ok ? phoneResult.e164 : draft.phone,
      ageYears: draft.ageYears,
      vehicle: draft.vehicle,
      vehicleMake: draft.vehicleMake.trim(),
      vehicleModel: draft.vehicleModel.trim(),
      vehiclePlate: draft.vehiclePlate.trim(),
      city: SERVICE_CITY,
      status: result.status,
      rejectionReason: current?.rejectionReason || '',
      createdAt: current?.createdAt || new Date().toISOString(),
      reviewedAt: current?.reviewedAt || null
    }))
  }

  const status = application?.status
  const StatusIcon = status ? STATUS_COPY[status].icon : Clock3

  return (
    <section className="page-section narrow courier-apply">
      <button className="back-link" type="button" onClick={onBack}><ArrowLeft size={16} /> رجوع</button>
      <span className="eyebrow">انضم إلى الفريق</span>
      <h1 className="page-title">طلب العمل كموصّل</h1>
      <p className="muted">التسجيل لا يمنحك صلاحية قبول الطلبات. الإدارة تراجع الطلب ثم تعتمد الحساب من قاعدة البيانات.</p>

      <div className="courier-feature-grid">
        <div><Bike /><b>دراجة نارية</b><span>طلبات محلية سريعة داخل السوقر.</span></div>
        <div><Car /><b>سيارة</b><span>طلبات أكبر حجماً داخل نطاق الخدمة.</span></div>
        <div><ShieldCheck /><b>اعتماد إداري</b><span>لا صلاحيات قبل موافقة المدير.</span></div>
        <div><CircleHelp /><b>بدون وثائق الآن</b><span>رفع الهوية والرخصة سيُضاف بعد تأمين التخزين.</span></div>
      </div>

      {loading && <div className="empty-state"><Loader2 className="spin" size={22} /> جارٍ تحميل حالة الطلب…</div>}

      {!loading && verified && (
        <div className="apply-status ok">
          <CheckCircle2 size={22} />
          <div>
            <b>حسابك معتمد كموصّل</b>
            <span>يمكنك استعمال لوحة العمل إن كان دور الحساب يسمح بذلك.</span>
          </div>
        </div>
      )}

      {!loading && status && (
        <div className={`apply-status ${STATUS_COPY[status].tone}`}>
          <StatusIcon size={22} />
          <div>
            <b>{STATUS_COPY[status].title}</b>
            <span>{STATUS_COPY[status].text}</span>
            {status === 'rejected' && application?.rejectionReason && (
              <small>سبب الرفض: {application.rejectionReason}</small>
            )}
          </div>
        </div>
      )}

      {pendingSql && (
        <div className="inline-alert warning" role="status">
          <CircleHelp size={18} />
          حفظ الطلب يحتاج موافقة على مقترح قاعدة البيانات. لم يُحفظ شيء ولم يتغيّر دور الحساب.
        </div>
      )}

      {!isAuthenticated && (
        <div className="inline-alert info">
          <UserRound size={18} />
          أنشئ حساب زبون أو سجّل الدخول أولاً، ثم أرسل طلب الانضمام من نفس الحساب.
          <button type="button" onClick={onRequireLogin}>تسجيل الدخول</button>
        </div>
      )}

      {!loading && (!locked || canResubmit) && (
        <form className="form-card order-form" onSubmit={event => { void onSubmit(event) }}>
          <div className="form-section">
            <div className="form-section-head">
              <span className="step-badge">1</span>
              <div>
                <h2>بيانات الموصّل</h2>
                <p>الاسم واللقب كما في الوثائق الرسمية لاحقاً.</p>
              </div>
            </div>
            <div className="form-row">
              <label className="field">
                الاسم
                <input value={firstName} onChange={e => setFirstName(e.target.value)} autoComplete="given-name" required />
                {errors.firstName && <span className="field-error">{errors.firstName}</span>}
              </label>
              <label className="field">
                اللقب
                <input value={lastName} onChange={e => setLastName(e.target.value)} autoComplete="family-name" required />
                {errors.lastName && <span className="field-error">{errors.lastName}</span>}
              </label>
            </div>
            <label className="field">
              رقم الهاتف
              <span className="input-wrap">
                <Phone size={17} />
                <input
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="0551234567"
                  required
                />
              </span>
              <span className="field-hint">رقم التواصل لهذا الطلب فقط. لا يغيّر رقم حسابك الأساسي.</span>
              {errors.phone && <span className="field-error">{errors.phone}</span>}
            </label>
            <label className="field">
              العمر
              <input
                value={age}
                onChange={e => setAge(e.target.value.replace(/[^\d]/g, '').slice(0, 2))}
                inputMode="numeric"
                placeholder="18"
                required
              />
              <span className="field-hint">يُشترط ألا يقل العمر عن 18 سنة.</span>
              {errors.age && <span className="field-error">{errors.age}</span>}
            </label>
          </div>

          <div className="form-section">
            <div className="form-section-head">
              <span className="step-badge">2</span>
              <div>
                <h2>وسيلة النقل</h2>
                <p>نعمل حالياً في بلدية السوقر، ولاية تيارت.</p>
              </div>
            </div>
            <div className="vehicle-options">
              <button
                type="button"
                className={vehicle === 'motorcycle' ? 'vehicle-option selected' : 'vehicle-option'}
                onClick={() => setVehicle('motorcycle')}
              >
                <Bike size={18} /> دراجة نارية
              </button>
              <button
                type="button"
                className={vehicle === 'car' ? 'vehicle-option selected' : 'vehicle-option'}
                onClick={() => setVehicle('car')}
              >
                <Car size={18} /> سيارة
              </button>
            </div>
            <div className="form-row">
              <label className="field">
                نوع / ماركة المركبة
                <input value={vehicleMake} onChange={e => setVehicleMake(e.target.value)} placeholder={vehicle === 'car' ? 'مثال: رينو' : 'مثال: ياماها'} />
              </label>
              <label className="field">
                الطراز
                <input value={vehicleModel} onChange={e => setVehicleModel(e.target.value)} placeholder="اختياري" />
              </label>
            </div>
            <label className="field">
              رقم اللوحة
              <input
                value={vehiclePlate}
                onChange={e => setVehiclePlate(e.target.value)}
                placeholder={vehicle === 'car' ? 'مطلوب للسيارة' : 'اختياري للدراجة'}
                dir="ltr"
              />
              {errors.plate && <span className="field-error">{errors.plate}</span>}
            </label>
            <p className="field-hint">منطقة الخدمة: {SERVICE_CITY} — ولاية تيارت. رفع الوثائق غير مفعّل في هذه المرحلة.</p>
          </div>

          <label className="auth-check">
            <input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} />
            <span>أوافق على شروط العمل كموصّل، وأعلم أن الإرسال لا يعني الاعتماد الفوري.</span>
          </label>
          {errors.terms && <span className="field-error">{errors.terms}</span>}
          {errors.submit && <div className="inline-alert danger" role="alert">{errors.submit}</div>}

          <div className="submit-row">
            <button className="primary-button full" type="submit" disabled={submitting || !isAuthenticated}>
              {submitting ? <><Loader2 size={18} className="spin" /> جارٍ الإرسال…</> : canResubmit ? 'إعادة إرسال الطلب' : 'إرسال طلب الانضمام'}
            </button>
            {!isAuthenticated && <p className="submit-hint">يلزم تسجيل الدخول قبل الحفظ في قاعدة البيانات.</p>}
          </div>
        </form>
      )}
    </section>
  )
}
