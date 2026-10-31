import { useEffect, useState } from 'react'
import { ArrowLeft, CheckCircle2, ClipboardList, Loader2, RefreshCw, Search, ShieldCheck, Star } from 'lucide-react'
import { trackGuestOrder } from '../lib/orders'
import { guestConfirmDelivery } from '../lib/delivery'
import { serviceTitle } from '../lib/services'
import { formatDzd, formatWhen } from '../lib/format'

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
  const [order, setOrder] = useState<{
    code: string; service: string; status: string; createdAt: string
    priceDzd: number; courierName: string
    courierConfirmed: boolean; customerConfirmed: boolean; completed: boolean
  } | null>(null)
  const [lastChecked, setLastChecked] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [confirmError, setConfirmError] = useState('')
  const [confirmNotice, setConfirmNotice] = useState('')

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
    setOrder({
      code: result.orderCode,
      service: result.service,
      status: result.status,
      createdAt: result.createdAt,
      priceDzd: result.priceDzd,
      courierName: result.courierName,
      courierConfirmed: result.courierConfirmed,
      customerConfirmed: result.customerConfirmed,
      completed: result.completed
    })
  }

  async function confirmReceipt() {
    if (!order) return
    setConfirming(true)
    setConfirmError('')
    setConfirmNotice('')
    const result = await guestConfirmDelivery(token.trim())
    setConfirming(false)
    if (!result.ok) {
      setConfirmError(result.error)
      return
    }
    setConfirmNotice(result.completed
      ? 'تم تأكيد الاستلام من الطرفين. طلبك مكتمل الآن.'
      : 'تم تسجيل تأكيدك للاستلام. بانتظار تأكيد الموصّل إن لم يكن قد أكّد بعد.')
    await lookup(token.trim())
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
            {order.priceDzd > 0 && ` · ${formatDzd(order.priceDzd)}`}
            {order.createdAt && ` · أُنشئ ${formatWhen(order.createdAt)}`}
            {order.courierName && ` · الموصّل: ${order.courierName}`}
          </p>

          {(order.courierConfirmed || order.customerConfirmed) && (
            <div className="confirm-strip">
              <span className={order.courierConfirmed ? 'confirm-chip on' : 'confirm-chip'}>
                <CheckCircle2 size={13} /> الموصّل {order.courierConfirmed ? 'أكّد التسليم' : 'لم يؤكّد بعد'}
              </span>
              <span className={order.customerConfirmed ? 'confirm-chip on' : 'confirm-chip'}>
                <ShieldCheck size={13} /> أنت {order.customerConfirmed ? 'أكّدت الاستلام' : 'لم تؤكّد بعد'}
              </span>
              {order.completed && <span className="confirm-chip done"><Star size={13} /> مكتمل من الطرفين</span>}
            </div>
          )}

          {confirmError && <div className="inline-alert danger" role="alert">{confirmError}</div>}
          {confirmNotice && <div className="inline-alert success" role="status">{confirmNotice}</div>}
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

          {order.status !== 'cancelled' && order.status !== 'pending' && !order.customerConfirmed && (
            <button
              type="button"
              className="primary-button full"
              onClick={() => void confirmReceipt()}
              disabled={confirming}
            >
              {confirming ? <Loader2 size={16} className="spin" /> : <ShieldCheck size={16} />} تأكيد استلام الطلب
            </button>
          )}
          {order.customerConfirmed && !order.completed && (
            <p className="field-hint">أكّدت الاستلام. يكتمل الطلب نهائيًا عندما يؤكّد الموصّل التسليم أيضًا.</p>
          )}

          <p className="track-note"><ShieldCheck size={15} /> حدّث الحالة يدويًا لرؤية آخر وضع مسجّل. لا نعرض بيانات الاتصال أو موقع الموصّل لأن واجهة التتبع الحالية لا تسترجع هذه البيانات. تأكيد الاستلام متاح فقط برمز التتبّع، ولا يُقبل برقم الطلب وحده.</p>
        </div>
      )}
    </section>
  )
}
