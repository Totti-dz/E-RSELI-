type Props = {
  error?: string
  onRetry?: () => void
}

export default function Splash({ error, onRetry }: Props) {
  return (
    <div className="splash" dir="rtl">
      <div className="splash-glow splash-glow-a" />
      <div className="splash-glow splash-glow-b" />

      <div className="splash-content">
        <div className="splash-logo">
          <img src="/brand/logo.webp" alt="ERSEL" />
        </div>
        <h1 className="splash-title">ERSEL</h1>
        <p className="splash-tagline">كلش يجي لعندك</p>
        <p className="splash-sub">توصيل محلي ببلدية السوقر، ولاية تيارت</p>

        {error ? (
          <div className="splash-error" role="alert">
            <span>{error}</span>
            {onRetry && <button onClick={onRetry}>إعادة المحاولة</button>}
          </div>
        ) : (
          <div className="splash-loader" aria-label="جارٍ التحميل">
            <span /><span /><span />
          </div>
        )}
      </div>

      <span className="splash-foot">ولاية تيارت — بلدية السوقر</span>
    </div>
  )
}
