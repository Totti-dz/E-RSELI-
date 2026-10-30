import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { MapPin, Search, X, Loader2, Globe } from 'lucide-react'
import { normalizeText, searchPlaces, type Place } from '../lib/geo/places'
import { REMOTE_SEARCH_ENABLED, searchRemotePlaces, type RemotePlace } from '../lib/geo/geocoder'
import { formatCoords } from '../lib/geo/places'
import type { LatLng } from '../lib/geo/config'

type Props = {
  field: 'pickup' | 'dropoff'
  label: string
  placeholder: string
  value: string
  point: LatLng | null
  error?: string
  active: boolean
  onChange: (value: string) => void
  onChoose: (place: Place) => void
  onFocusField: () => void
  onClearPoint: () => void
  onActivateMap: () => void
  compact?: boolean
}

export default function PlaceField({
  field, label, placeholder, value, point, error, active, onChange, onChoose, onFocusField, onClearPoint, onActivateMap, compact = false
}: Props) {
  const inputId = useId()
  const listId = `${inputId}-list`
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const [remoteBusy, setRemoteBusy] = useState(false)
  const [remoteError, setRemoteError] = useState('')
  const [remoteResults, setRemoteResults] = useState<RemotePlace[]>([])
  const abortRef = useRef<AbortController | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  const localResults = useMemo(() => searchPlaces(value), [value])
  const results: Place[] = remoteResults.length ? remoteResults : localResults
  const query = normalizeText(value)

  useEffect(() => {
    setRemoteResults([])
    setRemoteError('')
    setHighlight(0)
  }, [value])

  useEffect(() => {
    function onDocClick(event: MouseEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  useEffect(() => () => abortRef.current?.abort(), [])

  function choose(place: Place) {
    onChoose(place)
    setOpen(false)
    setRemoteResults([])
    setRemoteError('')
  }

  async function runRemoteSearch() {
    if (value.trim().length < 3) {
      setRemoteError('اكتب 3 أحرف على الأقل للبحث.')
      return
    }
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setRemoteBusy(true)
    setRemoteError('')
    const result = await searchRemotePlaces(value, { signal: controller.signal })
    if (controller.signal.aborted) return
    setRemoteBusy(false)
    if (result.ok) {
      setRemoteResults(result.results)
      setOpen(true)
      setHighlight(0)
    } else if (result.kind !== 'aborted') {
      setRemoteResults([])
      setRemoteError(result.error)
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      setOpen(false)
      return
    }
    if (!open || results.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlight(index => (index + 1) % results.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlight(index => (index - 1 + results.length) % results.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      choose(results[highlight])
    }
  }

  const showList = open && value.trim().length >= 2 && (results.length > 0 || !!remoteError)

  return (
    <div className={active ? 'place-field active' : 'place-field'} ref={wrapRef} data-compact={compact ? '1' : undefined}>
      <div className="place-label-row">
        <label htmlFor={inputId} className="place-label">
          <span className={`place-dot ${field}`} />
          {label}
        </label>
        {active && !compact && <span className="place-active-tag">الخريطة تستهدف هذه النقطة</span>}
      </div>

      <div className="place-input-wrap">
      <div className={`place-input ${error ? 'has-error' : ''}`}>
        <Search size={17} aria-hidden="true" />
        <input
          id={inputId}
          value={value}
          placeholder={placeholder}
          onChange={event => {
            onChange(event.target.value)
            setOpen(true)
            onFocusField()
          }}
          onFocus={() => {
            setOpen(true)
            onFocusField()
          }}
          onKeyDown={onKeyDown}
          autoComplete="off"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          inputMode="text"
        />
        {value && (
          <button
            type="button"
            className="place-clear"
            aria-label="مسح النص"
            onClick={() => {
              onChange('')
              onClearPoint()
              setOpen(false)
            }}
          >
            <X size={15} />
          </button>
        )}
      </div>

      {showList && (
        <ul className="place-suggestions" id={listId} role="listbox">
          {results.map((place, index) => (
            <li key={place.id} role="option" aria-selected={index === highlight}>
              <button
                type="button"
                className={index === highlight ? 'suggestion active' : 'suggestion'}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => choose(place)}
              >
                <MapPin size={15} aria-hidden="true" />
                <span className="suggestion-copy">
                  <b>{place.nameAr}</b>
                  <small>
                    {place.nameFr}
                    {place.kind === 'street' && ' · شارع'}
                    {place.kind === 'neighbourhood' && ' · حي'}
                    {place.kind === 'market' && ' · سوق'}
                    {place.kind === 'center' && ' · مركز المدينة'}
                  </small>
                </span>
              </button>
            </li>
          ))}
          {!results.length && remoteError && <li className="suggestion-note">{remoteError}</li>}
          {!localResults.length && query.length >= 2 && !remoteResults.length && (
            <li className="suggestion-note">
              لا توجد نتائج محلية موثّقة. يمكنك تحديد الموقع مباشرة على الخريطة.
            </li>
          )}
        </ul>
      )}
      </div>

      {!compact && (
        <div className="place-actions">
          <button
            type="button"
            className="place-map-button"
            onClick={() => {
              onActivateMap()
              document.getElementById('order-map-anchor')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }}
          >
            <MapPin size={15} /> حدّد على الخريطة
          </button>
          {REMOTE_SEARCH_ENABLED && (
            <button type="button" className="place-remote-button" onClick={runRemoteSearch} disabled={remoteBusy}>
              {remoteBusy ? <Loader2 size={15} className="spin" /> : <Globe size={15} />}
              {remoteBusy ? 'جارٍ البحث…' : 'ابحث في OpenStreetMap'}
            </button>
          )}
        </div>
      )}
      {compact && REMOTE_SEARCH_ENABLED && (
        <div className="place-actions">
          <button type="button" className="place-remote-button" onClick={runRemoteSearch} disabled={remoteBusy}>
            {remoteBusy ? <Loader2 size={15} className="spin" /> : <Globe size={15} />}
            {remoteBusy ? 'جارٍ البحث…' : 'ابحث في OpenStreetMap'}
          </button>
        </div>
      )}

      {point ? (
        <div className="place-selected">
          <MapPin size={15} aria-hidden="true" />
          <span>
            <b>تم التحديد</b>
            <small>{formatCoords(point)}</small>
          </span>
          <button type="button" onClick={onClearPoint} aria-label="إزالة النقطة">
            <X size={14} />
          </button>
        </div>
      ) : (
        !compact && <p className="place-empty">لم تُحدَّد النقطة بعد — اكتب عنواناً واختر اقتراحاً أو انقر على الخريطة.</p>
      )}

      {error && <p className="field-error">{error}</p>}
    </div>
  )
}
