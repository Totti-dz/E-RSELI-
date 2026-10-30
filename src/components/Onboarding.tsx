import { useRef, useState } from 'react'

type Props = { onFinish: () => void }

const slides = [
  {
    title: 'من عندهم حتى لعندك',
    text: 'حدد منين يتاخذ طلبك ووين يوصلك، وخلي الباقي علينا.',
    art: 'route' as const
  },
  {
    title: 'واش تحتاج؟ نجيبهولك',
    text: 'مواد غذائية، خضر، فواكه، مأكولات، ومشتريات أخرى… اطلب واش تحتاج.',
    art: 'shop' as const
  },
  {
    title: 'السعر بالاتفاق، والراحة ليك',
    text: 'شوف السعر المقترح، تفاوض مع السائق، واتفقوا قبل تأكيد الطلب.',
    art: 'price' as const
  }
]

function Illustration({ kind }: { kind: 'route' | 'shop' | 'price' }) {
  if (kind === 'route') {
    return (
      <svg viewBox="0 0 220 160" className="ob-svg" role="img" aria-label="مسار توصيل بين نقطتين">
        <circle className="ob-pulse" cx="45" cy="118" r="9" />
        <path className="ob-route" d="M45 118 C 80 118, 80 62, 118 62 S 168 62, 175 38" />
        <g className="ob-pin ob-pin-a">
          <circle cx="45" cy="118" r="13" />
          <circle cx="45" cy="118" r="4.5" className="ob-pin-dot" />
        </g>
        <g className="ob-pin ob-pin-b">
          <circle cx="175" cy="38" r="13" />
          <circle cx="175" cy="38" r="4.5" className="ob-pin-dot" />
        </g>
        <g className="ob-scooter">
          <circle cx="96" cy="74" r="7" />
          <circle cx="118" cy="74" r="7" />
          <path d="M96 74 L106 58 L118 74" />
        </g>
      </svg>
    )
  }
  if (kind === 'shop') {
    return (
      <svg viewBox="0 0 220 160" className="ob-svg" role="img" aria-label="كيس مشتريات">
        <path className="ob-bag" d="M70 56 h80 l10 74 a8 8 0 0 1 -8 8 H68 a8 8 0 0 1 -8 -8 Z" />
        <path className="ob-handle" d="M88 58 v-8 a22 22 0 0 1 44 0 v8" />
        <rect className="ob-item ob-item-1" x="78" y="82" width="20" height="34" rx="4" />
        <circle className="ob-item ob-item-2" cx="122" cy="99" r="13" />
        <rect className="ob-item ob-item-3" x="104" y="103" width="16" height="13" rx="3" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 220 160" className="ob-svg" role="img" aria-label="عرض سعر ثم قبوله">
      <rect className="ob-card" x="48" y="34" width="124" height="92" rx="14" />
      <rect className="ob-line" x="66" y="54" width="58" height="8" rx="4" />
      <rect className="ob-line ob-line-soft" x="66" y="72" width="88" height="7" rx="3.5" />
      <rect className="ob-line ob-line-soft" x="66" y="87" width="70" height="7" rx="3.5" />
      <circle className="ob-check" cx="150" cy="110" r="17" />
      <path className="ob-check-mark" d="M142 110 l6 6 l11 -12" />
    </svg>
  )
}

export default function Onboarding({ onFinish }: Props) {
  const [index, setIndex] = useState(0)
  const touchStart = useRef<number | null>(null)
  const isLast = index === slides.length - 1
  const slide = slides[index]

  const next = () => {
    if (isLast) onFinish()
    else setIndex(i => Math.min(i + 1, slides.length - 1))
  }

  const onTouchStart = (e: React.TouchEvent) => { touchStart.current = e.touches[0].clientX }
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStart.current === null) return
    const delta = e.changedTouches[0].clientX - touchStart.current
    touchStart.current = null
    if (Math.abs(delta) < 45) return
    if (delta > 0 && index > 0) setIndex(i => i - 1)
    if (delta < 0 && index < slides.length - 1) setIndex(i => i + 1)
  }

  return (
    <div className="onboarding" dir="rtl">
      <button className="ob-skip" onClick={onFinish}>تخطي</button>
      <div className="ob-logo">
        <img src="/brand/logo.webp" alt="ERSEL" />
      </div>

      <div
        className="ob-stage"
        key={index}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div className="ob-art"><Illustration kind={slide.art} /></div>
        <h1 className="ob-title">{slide.title}</h1>
        <p className="ob-text">{slide.text}</p>
      </div>

      <div className="ob-footer">
        <div className="ob-dots" role="tablist" aria-label="صفحات المقدمة">
          {slides.map((s, i) => (
            <button
              key={s.title}
              role="tab"
              aria-selected={i === index}
              aria-label={`الصفحة ${i + 1}`}
              className={i === index ? 'ob-dot active' : 'ob-dot'}
              onClick={() => setIndex(i)}
            />
          ))}
        </div>
        <button className="ob-next" onClick={next}>
          {isLast ? 'لنبدأ' : 'التالي'}
        </button>
      </div>
    </div>
  )
}
