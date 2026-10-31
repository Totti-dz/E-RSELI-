import { Star } from 'lucide-react'

type Props = {
  value: number
  onChange?: (value: number) => void
  size?: number
  label?: string
  count?: number
}

/** Five stars. Read-only when `onChange` is absent. */
export default function RatingStars({ value, onChange, size = 16, label, count }: Props) {
  const interactive = typeof onChange === 'function'
  const rounded = Math.round(value * 2) / 2

  return (
    <span className={interactive ? 'stars interactive' : 'stars'} dir="ltr">
      {[1, 2, 3, 4, 5].map(star => {
        const filled = rounded >= star
        const half = !filled && rounded >= star - 0.5
        return interactive ? (
          <button
            key={star}
            type="button"
            className={filled || half ? 'star on' : 'star'}
            onClick={() => onChange?.(star)}
            aria-label={`${star} من 5`}
            aria-pressed={value === star}
          >
            <Star size={size} fill={filled ? 'currentColor' : 'none'} />
          </button>
        ) : (
          <span key={star} className={filled ? 'star on' : half ? 'star half' : 'star'} aria-hidden="true">
            <Star size={size} fill={filled ? 'currentColor' : 'none'} />
          </span>
        )
      })}
      {label && <span className="stars-label">{label}</span>}
      {typeof count === 'number' && <span className="stars-count">({count})</span>}
    </span>
  )
}
