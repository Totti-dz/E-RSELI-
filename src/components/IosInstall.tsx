import { useEffect } from 'react'
import { Share, SquarePlus, X, BellRing } from 'lucide-react'

type Props = { onClose: () => void }

/** خطوات تثبيت ERSEL على الآيفون: سفاري فقط، ولا يوجد APK على iOS. */
export default function IosInstall({ onClose }: Props) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="apk-sheet" role="dialog" aria-modal="true" aria-labelledby="ios-sheet-title">
      <button className="apk-sheet-backdrop" type="button" aria-label="إغلاق" onClick={onClose} />
      <div className="apk-sheet-card">
        <button className="apk-sheet-close" type="button" aria-label="إغلاق" onClick={onClose}><X size={18} /></button>
        <header className="apk-sheet-head">
          <span className="apk-sheet-icon"><img src="/brand/logo-mark.webp" alt="ERSEL" /></span>
          <div>
            <h2 id="ios-sheet-title">ثبّت ERSEL على آيفون</h2>
            <p>يعمل كتطبيق كامل الشاشة بأيقونة على الشاشة الرئيسية، دون متجر.</p>
          </div>
        </header>
        <ol className="apk-steps">
          <li><b>افتح الموقع في Safari</b><span>التثبيت لا يعمل من Chrome أو من داخل تطبيقات أخرى على الآيفون.</span></li>
          <li><b>اضغط زر المشاركة <Share size={15} style={{ verticalAlign: 'middle' }} /></b><span>في أسفل الشاشة (أو أعلاها على iPad).</span></li>
          <li><b>اختر «إضافة إلى الشاشة الرئيسية» <SquarePlus size={15} style={{ verticalAlign: 'middle' }} /></b><span>ثم اضغط «إضافة». ستجد أيقونة ERSEL بين تطبيقاتك.</span></li>
        </ol>
        <section className="apk-block">
          <div className="apk-block-head"><BellRing size={17} /><b>الإشعارات على الآيفون</b></div>
          <p className="apk-block-hint">
            إشعارات الويب على الآيفون تعمل فقط بعد التثبيت على الشاشة الرئيسية (iOS 16.4 وأحدث). افتح التطبيق من الأيقونة ثم اسمح بالإشعارات.
          </p>
        </section>
      </div>
    </div>
  )
}
