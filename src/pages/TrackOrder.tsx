import { useEffect, useState } from 'react'
import { ArrowLeft, CheckCircle2, ClipboardList, Loader2, RefreshCw, Search, ShieldCheck } from 'lucide-react'
import { trackGuestOrder } from '../lib/orders'
import { serviceTitle } from '../lib/services'

type Props = {
  initialToken?: string
  onBack: () => void
}

const STATUS_STEPS = ['pending', 'accepted', 'picked_up', 'in_transit', 'delivered']
const STATUS_HELP: Record<string, string> = {
  pending: 'طلبك مسجّل وينتظر قبول موصّل متاح.',
  accepted: 'تم قبول الطلب من الموصّل. يجري التنسيق للاستلام.',
  picked_up: 'استلم الموصّل الطلب من نقطة الانطلاق.',
  in_transit: 'الطلب في الطريق إلى نقطة الوصول.',
  delivered: 'اكتملت عملية التوصيل.',
  cancelled: 'تم إلغاء الطلب. إذا لم تتوقع ذلك، تواصل مع فريق ERSEL.'
}
const STATUS_LABELS: Record<string, string> = {
  pending: 'بانتظار موصّل',
  accepted: 'تم قبول الطلب',
  picked_up: 'تم الاستلام',
  in_transit: 'في الطريق',
  delivered: 'تم التسليم',
  cancelled: 'ملغي'
}

export default function TrackOrder({ initialToken = '', onBack }: Props) {
  const [token, setToken] = useState(initialToken)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [order, setOrder] = useState<{ code: string; service: string; status: string; createdAt: string } | null>(null)
  const [lastChecked, setLastChecked] = useState('')

  async function lookup(value: string) {
    setLoading(true)
    setError('')
    setOrder(null)
    const result = await trackGuestOrder(value)
    setLoading(false)
    setLastChecked(new Date().toLocaleTimeString('ar-DZ', { hour: '2-digit', minute: '2-digit' }))
    if (!result.ok) {
      setError(result.error)
      return
    }
    setOrder({ code: result.orderCode, service: result.service, status: result.status, createdAt: result.createdAt })
  }

  useEffect(() => {
    if (initialToken.trim().length >= 32) void lookup(initialToken.trim())
  }, [initialToken])

  const stepIndex = order ? STATUS_STEPS.indexOf(order.status) : -1

  return (
    <section className="page-section narrow">
      <button className="back-link" onClick={onBack}><ArrowLeft size={16} /> رجوع</button>
      <span className="eyebrow">متابعة</span>
      <h1 className="page-title">تتبّع طلب ضيف</h1>
      <p className="muted">تابع مراحل طلبك من انتظار الموصّل حتى التسليم. أدخل رمز التتبع الذي ظهر بعد الإرسال؛ وهو الوسيلة الوحيدة للوصول إلى طلب الضيف.</p>

      <form
        className="form-card track-form"
        onSubmit={event => {
          event.preventDefault()
          void lookup(token.trim())
        }}
      >
        <label className="field">
          <span>رمز التتبع</span>
          <input
            value={token}
            onChange={event => setToken(event.target.value)}
            placeholder="الصق رمز التتبع هنا"
            dir="ltr"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <button className="primary-button full" type="submit" disabled={loading || token.trim().length < 32}>
          {loading ? <><Loader2 size={18} className="spin" /> جارٍ البحث…</> : <><Search size={18} /> عرض الحالة</>}
        </button>
      </form>

      {error && <div className="inline-alert danger" role="alert">{error}</div>}

      {order && (
        <div className="track-card">
          <div className="track-head">
            <div>
              <span className="eyebrow">رقم الطلب</span>
              <b>{order.code || '—'}</b>
            </div>
            <span className={`status status-${order.status}`}>{STATUS_LABELS[order.status] || order.status}</span>
          </div>
          <p className="muted track-meta">
            {serviceTitle(order.service)}
            {order.createdAt && ` · أُنشئ ${new Date(order.createdAt).toLocaleString('ar-DZ')}`}
          </p>
          <div className={`track-current track-current-${order.status}`}>
            <span className="track-current-icon">{order.status === 'delivered' ? <CheckCircle2 size={21} /> : order.status === 'cancelled' ? <ShieldCheck size={21} /> : <ClipboardList size={21} />}</span>
            <div><b>{STATUS_LABELS[order.status] || order.status}</b><p>{STATUS_HELP[order.status] || 'تحقق من الحالة مرة أخرى بعد قليل.'}</p></div>
          </div>
          <div className="track-progress-heading"><b>مراحل التوصيل</b><span>{lastChecked ? `آخر تحديث: ${lastChecked}` : ''}</span></div>
          <ol className="track-steps">
            {STATUS_STEPS.map((step, index) => {
              const state = order.status === 'cancelled' ? 'idle' : index < stepIndex ? 'done' : index === stepIndex ? 'current' : 'idle'
              return (
                <li key={step} className={state}>
                  <span className="track-dot" />
                  {STATUS_LABELS[step]}
                </li>
              )
            })}
          </ol>
          <button type="button" className="secondary-button track-refresh" onClick={() => void lookup(token.trim())} disabled={loading}>
            {loading ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />} تحديث الحالة
          </button>
          <p className="track-note"><ShieldCheck size={15} /> حدّث الحالة يدويًا لرؤية آخر وضع مسجّل. لا نعرض بيانات الاتصال أو موقع الموصّل لأن واجهة التتبع الحالية لا تسترجع هذه البيانات.</p>
        </div>
      )}
    </section>
  )
}
