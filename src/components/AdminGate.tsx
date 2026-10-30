import { useState } from 'react'
import { Eye, EyeOff, ListChecks, Lock, ShieldCheck, X } from 'lucide-react'

type Result = { ok: true } | { ok: false; error: string }

type Props = {
  onClose: () => void
  onUnlock: (pin: string) => Promise<Result>
  /** Read-only dashboard: needs the code only, no session and no admin role. */
  onReadOnly?: (pin: string) => Promise<Result>
}

export default function AdminGate({ onClose, onUnlock, onReadOnly }: Props) {
  const [pin, setPin] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<'admin' | 'read' | null>(null)

  async function run(kind: 'admin' | 'read') {
    if (busy) return
    if (!pin.trim()) {
      setError('أدخل الرمز أولًا.')
      return
    }
    setError('')
    setBusy(kind)
    try {
      const handler = kind === 'admin' ? onUnlock : onReadOnly
      if (!handler) {
        setError('هذا المسار غير متاح.')
        return
      }
      const result = await handler(pin.trim())
      if (!result.ok) setError(result.error)
    } catch {
      setError('تعذّر التحقق من الرمز. أعد المحاولة.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="admin-gate" role="dialog" aria-modal="true" aria-labelledby="admin-gate-title">
      <button className="admin-gate-backdrop" type="button" aria-label="إغلاق" onClick={onClose} />
      <form
        className="admin-gate-card"
        onSubmit={event => {
          event.preventDefault()
          void run('admin')
        }}
      >
        <button className="admin-gate-close" type="button" aria-label="إغلاق" onClick={onClose}><X size={18} /></button>
        <span className="brand-mark admin-gate-mark"><img src="/brand/logo-mark.webp" alt="ERSEL" /></span>
        <h2 id="admin-gate-title">دخول الإدارة</h2>
        <p>يُتحقق من الرمز على الخادم فقط. لوحة الإدارة الكاملة تحتاج جلسة بدور مدير، أما العرض بالرمز فهو قراءة فقط.</p>
        <label className="admin-gate-field">
          رمز الإدارة
          <span className="admin-gate-input">
            <Lock size={16} />
            <input
              type={show ? 'text' : 'password'}
              autoComplete="off"
              value={pin}
              onChange={event => { setPin(event.target.value); setError('') }}
              maxLength={64}
              autoFocus
            />
            <button type="button" aria-label={show ? 'إخفاء الرمز' : 'إظهار الرمز'} onClick={() => setShow(current => !current)}>
              {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </span>
        </label>
        {error && <div className="inline-alert danger" role="alert">{error}</div>}
        <button className="primary-button" type="submit" disabled={!!busy}>
          <ShieldCheck size={16} /> {busy === 'admin' ? 'جارٍ التحقق…' : 'دخول لوحة الإدارة'}
        </button>
        {onReadOnly && (
          <button
            className="admin-gate-readonly"
            type="button"
            disabled={!!busy}
            onClick={() => void run('read')}
          >
            <ListChecks size={16} />
            {busy === 'read' ? 'جارٍ فتح العرض…' : 'عرض الطلبات والحسابات بالرمز (قراءة فقط)'}
          </button>
        )}
      </form>
    </div>
  )
}
