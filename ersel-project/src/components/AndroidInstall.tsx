import { useEffect, useMemo, useState } from 'react'
import {
  BellRing, Check, Copy, Download, ExternalLink, ShieldAlert,
  Smartphone, Volume2, X
} from 'lucide-react'
import { APK_URL, ANDROID_MIN_VERSION, APP_VERSION, hasApkLink } from '../lib/release'
import {
  notificationPermission, notificationsEnabled, notificationSupport,
  requestNotifications, sendTestNotification, setNotificationsEnabled
} from '../lib/notifications'

/** Chrome-only event; not in the DOM typings. */
type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }

type Props = { onClose: () => void }

export default function AndroidInstall({ onClose }: Props) {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null)
  const [copied, setCopied] = useState(false)
  const [permission, setPermission] = useState<'granted' | 'denied' | 'prompt'>('prompt')
  const [enabled, setEnabled] = useState(() => notificationsEnabled())
  const [feedback, setFeedback] = useState('')
  const [busy, setBusy] = useState(false)

  const support = useMemo(() => notificationSupport(), [])

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as InstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])

  useEffect(() => {
    void notificationPermission().then(setPermission)
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(APK_URL)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2200)
    } catch {
      setFeedback('تعذّر النسخ. اضغط مطوّلًا على الرابط لنسخه.')
    }
  }

  async function toggleNotifications() {
    if (busy) return
    setBusy(true)
    setFeedback('')
    try {
      if (enabled) {
        await setNotificationsEnabled(false)
        setEnabled(false)
        setFeedback('أُوقفت الإشعارات داخل التطبيق.')
        return
      }
      const result = await requestNotifications()
      if (result !== 'unsupported') setPermission(result)
      if (result !== 'granted') {
        setFeedback(result === 'denied'
          ? 'الصلاحية مرفوضة. فعّلها من إعدادات الهاتف ← التطبيقات ← ERSEL ← الإشعارات.'
          : 'لم تُمنح الصلاحية بعد.')
        return
      }
      await setNotificationsEnabled(true)
      setEnabled(true)
      setFeedback('تم التشغيل. سيصلك تنبيه بصوت ERSEL عند تغيّر حالة طلبك.')
    } finally {
      setBusy(false)
    }
  }

  async function testSound() {
    setFeedback('')
    const result = await sendTestNotification()
    setFeedback(result.ok ? 'أُرسل إشعار تجريبي الآن.' : result.error)
  }

  return (
    <div className="apk-sheet" role="dialog" aria-modal="true" aria-labelledby="apk-sheet-title">
      <button className="apk-sheet-backdrop" type="button" aria-label="إغلاق" onClick={onClose} />
      <div className="apk-sheet-card">
        <button className="apk-sheet-close" type="button" aria-label="إغلاق" onClick={onClose}><X size={18} /></button>

        <header className="apk-sheet-head">
          <span className="apk-sheet-icon"><img src="/brand/logo-mark.webp" alt="ERSEL" /></span>
          <div>
            <h2 id="apk-sheet-title">تطبيق ERSEL للأندرويد</h2>
            <p>الإصدار {APP_VERSION} · أندرويد {ANDROID_MIN_VERSION} وأحدث</p>
          </div>
        </header>

        {hasApkLink ? (
          <>
            <a className="apk-download-button" href={APK_URL} rel="noopener noreferrer">
              <Download size={19} />
              تحميل ملف APK
            </a>
            <button className="apk-copy-link" type="button" onClick={() => void copyLink()}>
              {copied ? <Check size={15} /> : <Copy size={15} />}
              {copied ? 'تم نسخ الرابط' : 'نسخ رابط التحميل'}
            </button>
          </>
        ) : (
          <div className="apk-note">
            <ShieldAlert size={17} />
            <span>
              رابط APK يُضاف عند نشر أول إصدار على GitHub. حتى ذلك الحين ثبّت ERSEL كتطبيق
              من المتصفح بالخطوات أدناه — يعمل بنفس الشكل وبنفس الإشعارات.
            </span>
          </div>
        )}

        <ol className="apk-steps">
          <li><b>حمّل الملف</b><span>من الزر أعلاه عبر متصفح الهاتف، لا من حاسوب.</span></li>
          <li><b>اسمح بالتثبيت</b><span>إن ظهر تحذير «مصادر غير معروفة» اسمح به لمرة واحدة ثم أكمل.</span></li>
          <li><b>افتح ERSEL واسمح بالإشعارات</b><span>ليصلك صوت التنبيه عند قبول الطلب أو تسليمه.</span></li>
        </ol>

        <section className="apk-block">
          <div className="apk-block-head">
            <BellRing size={17} />
            <b>إشعارات الطلبات</b>
            <span className={enabled ? 'apk-state on' : 'apk-state'}>{enabled ? 'مفعّلة' : 'متوقفة'}</span>
          </div>
          <p className="apk-block-hint">
            {support === 'unsupported'
              ? 'هذا المتصفح لا يدعم الإشعارات. ثبّت تطبيق أندرويد للحصول عليها.'
              : permission === 'denied'
                ? 'الإشعارات مرفوضة من إعدادات الهاتف. فعّلها من: الإعدادات ← التطبيقات ← ERSEL ← الإشعارات.'
                : 'يصلك تنبيه بصوت مخصص عند تغيّر حالة طلبك، حتى والتطبيق في الخلفية عند تفعيل الإشعارات الفورية.'}
          </p>
          <div className="apk-block-actions">
            <button
              className={enabled ? 'secondary-button' : 'primary-button'}
              type="button"
              disabled={busy || support === 'unsupported' || permission === 'denied'}
              onClick={() => void toggleNotifications()}
            >
              <BellRing size={16} /> {busy ? 'جارٍ…' : enabled ? 'إيقاف الإشعارات' : 'تشغيل الإشعارات'}
            </button>
            <button
              className="apk-ghost-button"
              type="button"
              disabled={permission !== 'granted'}
              onClick={() => void testSound()}
            >
              <Volume2 size={16} /> تجربة الصوت
            </button>
          </div>
          {feedback && <div className="apk-feedback" role="status">{feedback}</div>}
        </section>

        <section className="apk-block">
          <div className="apk-block-head">
            <Smartphone size={17} />
            <b>تثبيت بدون APK</b>
          </div>
          <p className="apk-block-hint">
            من متصفح Chrome: القائمة ⋮ ← «إضافة إلى الشاشة الرئيسية». تعمل النسخة كتطبيق
            كامل الشاشة دون متجر.
          </p>
          {installPrompt && (
            <button
              className="apk-ghost-button"
              type="button"
              onClick={() => {
                void installPrompt.prompt()
                setInstallPrompt(null)
              }}
            >
              <ExternalLink size={16} /> تثبيت الآن من المتصفح
            </button>
          )}
        </section>

        <p className="apk-sheet-foot">
          التطبيق نسخة من نفس الموقع داخل غلاف أندرويد — نفس الحساب ونفس الطلبات.
        </p>
      </div>
    </div>
  )
}
