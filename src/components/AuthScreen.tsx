import { useState } from 'react'
import { ArrowLeft, Bike, CheckCircle2, Eye, EyeOff, Lock, LogIn, Phone, ShieldCheck, UserRound } from 'lucide-react'
import { passwordProblem, resetPasswordByPhone, signInWithIdentifier, signOutEverywhere, signUpCustomer } from '../lib/auth'
import type { AppRole } from '../lib/auth'

type Props = {
  onDone: (role: AppRole | null) => void
  onGuest?: () => void
  onCodeDesk?: () => void
  initialRole?: 'customer' | 'employee'
  initialMode?: 'choose' | 'login' | 'register'
  reason?: string
}

type Step = 'choose' | 'login' | 'register' | 'reset'
type Role = 'customer' | 'employee'

export default function AuthScreen({ onDone, onGuest, onCodeDesk, initialRole = 'customer', initialMode = 'choose', reason }: Props) {
  const [step, setStep] = useState<Step>(initialMode)
  const [role, setRole] = useState<Role>(initialRole)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const [loginId, setLoginId] = useState('')
  const [loginPassword, setLoginPassword] = useState('')

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [accepted, setAccepted] = useState(false)

  const [resetPhone, setResetPhone] = useState('')
  const [resetPassword, setResetPassword] = useState('')
  const [resetConfirm, setResetConfirm] = useState('')
  const [resetDone, setResetDone] = useState(false)

  async function doReset(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (resetPassword !== resetConfirm) {
      setError('كلمتا المرور غير متطابقتين.')
      return
    }
    setLoading(true)
    const result = await resetPasswordByPhone({ phone: resetPhone, password: resetPassword })
    setLoading(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setLoginId(resetPhone)
    setLoginPassword('')
    setResetPassword('')
    setResetConfirm('')
    setResetDone(true)
    setStep('login')
  }

  function go(next: Step, nextRole: Role = role) {
    setError('')
    setRole(nextRole)
    setStep(next)
  }

  async function doLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const result = await signInWithIdentifier({ identifier: loginId, password: loginPassword })
    setLoading(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    if ('profileMissing' in result && result.profileMissing) {
      setError('تم الدخول لكن الملف الشخصي غير محفوظ بعد. أعد المحاولة أو تواصل مع الإدارة. لم يتم تسجيل خروجك.')
      return
    }
    const resolved = result.role
    if (role === 'employee' && resolved === 'customer') {
      await signOutEverywhere()
      setError('هذا الحساب حساب زبون. استعمل تبويب «أنا زبون» للدخول.')
      return
    }
    if (role === 'customer' && (resolved === 'employee' || resolved === 'courier' || resolved === 'admin')) {
      onDone(resolved)
      return
    }
    onDone(resolved)
  }

  async function doRegister(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!accepted) {
      setError('يجب الموافقة على شروط الاستخدام وسياسة الخصوصية.')
      return
    }
    if (password !== confirm) {
      setError('كلمتا المرور غير متطابقتين.')
      return
    }
    const problem = passwordProblem(password)
    if (problem) {
      setError(problem)
      return
    }
    setLoading(true)
    const result = await signUpCustomer({ fullName: name, phone, password })
    setLoading(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onDone('customer')
  }

  return (
    <div className="auth-screen" dir="rtl">
      <div className="auth-panel">
        <div className="auth-brand">
          <img src="/brand/logo.webp" alt="ERSEL" />
          <div>
            <b>ERSEL</b>
            <small>كلش يجي لعندك · السوقر</small>
          </div>
        </div>

        {reason && <div className="auth-note">{reason}</div>}

        {step === 'choose' && (
          <>
            <h1 className="auth-title">مرحبًا بك في ERSEL</h1>
            <p className="auth-sub">كيف تحب تستعمل التطبيق؟</p>

            <button className="role-card" onClick={() => go('login', 'customer')}>
              <span className="role-icon"><UserRound size={22} /></span>
              <span className="role-copy">
                <b>أنا زبون</b>
                <small>اطلب توصيلاً أو مشتريات، وتابع طلباتك.</small>
              </span>
              <ArrowLeft size={18} />
            </button>

            <button className="role-card" onClick={() => go('login', 'employee')}>
              <span className="role-icon role-icon-dark"><Bike size={22} /></span>
              <span className="role-copy">
                <b>أنا موظف</b>
                <small>دخول للموظفين والسائقين المعتمدين فقط.</small>
              </span>
              <ArrowLeft size={18} />
            </button>

            <div className="auth-hint">
              <ShieldCheck size={16} />
              <span>حسابات الموظفين تُنشأ وتُعتمد من الإدارة فقط.</span>
            </div>

            {onGuest && (
              <button className="auth-guest" onClick={onGuest}>تصفّح كزائر</button>
            )}
            {onCodeDesk && (
              <button className="auth-codedesk" onClick={onCodeDesk}>
                <ShieldCheck size={14} /> لديك رمز إدارة؟ اعرض الطلبات والحسابات
              </button>
            )}
          </>
        )}

        {step === 'reset' && (
          <>
            <button className="auth-back" onClick={() => go('login')}><ArrowLeft size={16} /> رجوع</button>
            <h1 className="auth-title">استعادة كلمة المرور</h1>
            <p className="auth-sub">أدخل رقم هاتفك المسجّل ثم كلمة المرور الجديدة.</p>
            <form className="auth-form" onSubmit={doReset}>
              <label>
                رقم الهاتف
                <span className="input-wrap">
                  <Phone size={17} />
                  <input value={resetPhone} onChange={e => setResetPhone(e.target.value)} placeholder="0551234567" inputMode="tel" autoComplete="tel" required />
                </span>
              </label>
              <label>
                كلمة المرور الجديدة
                <span className="input-wrap">
                  <Lock size={17} />
                  <input type={showPassword ? 'text' : 'password'} value={resetPassword} onChange={e => setResetPassword(e.target.value)} autoComplete="new-password" required />
                  <button type="button" className="input-eye" onClick={() => setShowPassword(v => !v)} aria-label="إظهار كلمة المرور">
                    {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </span>
              </label>
              <label>
                أعد كتابة كلمة المرور
                <span className="input-wrap">
                  <Lock size={17} />
                  <input type={showPassword ? 'text' : 'password'} value={resetConfirm} onChange={e => setResetConfirm(e.target.value)} autoComplete="new-password" required />
                </span>
              </label>
              {error && <div className="auth-error" role="alert">{error}</div>}
              <button className="primary-button full" disabled={loading}>
                {loading ? 'جارٍ الحفظ…' : 'تغيير كلمة المرور'} <CheckCircle2 size={17} />
              </button>
            </form>
          </>
        )}

        {step === 'login' && (
          <>
            <button className="auth-back" onClick={() => go('choose')}><ArrowLeft size={16} /> رجوع</button>
            <h1 className="auth-title">{role === 'employee' ? 'دخول الموظفين' : 'تسجيل الدخول'}</h1>
            <p className="auth-sub">
              {role === 'employee'
                ? 'استعمل رقم هاتفك وكلمة المرور.'
                : 'استعمل رقم هاتفك وكلمة المرور.'}
            </p>

            <form className="auth-form" onSubmit={doLogin}>
              <label>
                رقم الهاتف
                <span className="input-wrap">
                  <Phone size={17} />
                  <input
                    value={loginId}
                    onChange={e => setLoginId(e.target.value)}
                    placeholder="0551234567"
                    inputMode="tel"
                    autoComplete="tel"
                    required
                  />
                </span>
              </label>

              <label>
                كلمة المرور
                <span className="input-wrap">
                  <Lock size={17} />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={loginPassword}
                    onChange={e => setLoginPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    required
                  />
                  <button type="button" className="input-eye" onClick={() => setShowPassword(v => !v)} aria-label="إظهار كلمة المرور">
                    {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </span>
              </label>

              {resetDone && !error && <div className="auth-success" role="status">تم تغيير كلمة المرور. سجّل الدخول بها الآن.</div>}
              {error && <div className="auth-error" role="alert">{error}</div>}

              <button className="primary-button full" disabled={loading}>
                {loading ? 'جارٍ الدخول…' : 'تسجيل الدخول'} <LogIn size={17} />
              </button>
            </form>

            <div className="auth-links">
              <button onClick={() => { setResetDone(false); setResetPhone(loginId); go('reset') }}>نسيت كلمة المرور؟</button>
              {role === 'customer' && <button onClick={() => go('register', 'customer')}>إنشاء حساب جديد</button>}
            </div>
          </>
        )}

        {step === 'register' && (
          <>
            <button className="auth-back" onClick={() => go('login', 'customer')}><ArrowLeft size={16} /> رجوع</button>
            <h1 className="auth-title">حساب زبون جديد</h1>
            <p className="auth-sub">أنشئ حسابك للطلب ومتابعة التوصيل.</p>

            <form className="auth-form" onSubmit={doRegister}>
              <label>
                الاسم الكامل
                <span className="input-wrap">
                  <UserRound size={17} />
                  <input value={name} onChange={e => setName(e.target.value)} placeholder="مثال: محمد أمين" autoComplete="name" required />
                </span>
              </label>

              <label>
                رقم الهاتف
                <span className="input-wrap">
                  <Phone size={17} />
                  <input
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    placeholder="0551234567"
                    inputMode="tel"
                    autoComplete="tel"
                    required
                  />
                </span>
              </label>

              <div className="auth-grid">
                <label>
                  كلمة المرور
                  <span className="input-wrap">
                    <Lock size={17} />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="8 أحرف على الأقل"
                      autoComplete="new-password"
                      required
                    />
                  </span>
                </label>
                <label>
                  تأكيد كلمة المرور
                  <span className="input-wrap">
                    <Lock size={17} />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={confirm}
                      onChange={e => setConfirm(e.target.value)}
                      placeholder="أعد كتابتها"
                      autoComplete="new-password"
                      required
                    />
                  </span>
                </label>
              </div>

              <label className="auth-check">
                <input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} />
                <span>أوافق على شروط الاستخدام وسياسة الخصوصية.</span>
              </label>

              {error && <div className="auth-error" role="alert">{error}</div>}

              <button className="primary-button full" disabled={loading}>
                {loading ? 'جارٍ إنشاء الحساب…' : 'إنشاء الحساب'} <CheckCircle2 size={17} />
              </button>
            </form>

            <div className="auth-links">
              <button onClick={() => go('login', 'customer')}>لدي حساب بالفعل</button>
            </div>
          </>
        )}
      </div>

      <div className="auth-side" aria-hidden="true">
        <div className="auth-side-inner">
          <h2>كلش يجي لعندك</h2>
          <p>توصيل، تسوّق، وراحة البال… كلشي أقرب ليك.</p>
          <ul>
            <li>توصيل من مكان إلى مكان</li>
            <li>اشريلي: نشتري ونوصل لك</li>
            <li>السعر بالاتفاق مع السائق</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
