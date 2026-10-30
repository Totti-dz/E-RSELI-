import type { Place } from './places'

/**
 * Optional remote lookup against OpenStreetMap Nominatim.
 *
 * IMPORTANT: Nominatim's usage policy forbids client-side autocomplete and
 * caps requests at 1/second. Therefore this is only used when the user
 * explicitly presses "ابحث في OpenStreetMap" and the feature is enabled.
 * It is disabled by default; production should use a provider with a
 * proper usage agreement (and its own API key) instead.
 */
export const REMOTE_SEARCH_ENABLED = import.meta.env.VITE_OSM_SEARCH === '1'
export const REMOTE_SEARCH_ATTRIBUTION = 'نتائج البحث من OpenStreetMap contributors (ODbL)'

type NominatimResult = {
  place_id: number
  display_name: string
  lat: string
  lon: string
  type?: string
  class?: string
}

export type RemotePlace = Place & { displayName: string }

let lastRequestAt = 0
let queue: Promise<unknown> = Promise.resolve()

function throttle<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = 1100 - (Date.now() - lastRequestAt)
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait))
    lastRequestAt = Date.now()
    return task()
  })
  queue = run.catch(() => undefined)
  return run
}

export type RemoteSearchResult =
  | { ok: true; results: RemotePlace[] }
  | { ok: false; error: string; kind: 'offline' | 'unavailable' | 'aborted' | 'empty' }

export async function searchRemotePlaces(
  query: string,
  options: { signal?: AbortSignal; near?: { lat: number; lng: number } } = {}
): Promise<RemoteSearchResult> {
  const q = query.trim()
  if (q.length < 3) return { ok: false, error: 'اكتب 3 أحرف على الأقل للبحث.', kind: 'empty' }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { ok: false, error: 'لا يوجد اتصال بالإنترنت.', kind: 'offline' }
  }
  if (!REMOTE_SEARCH_ENABLED) {
    return { ok: false, error: 'البحث عبر الإنترنت غير مفعّل في هذه النسخة.', kind: 'unavailable' }
  }

  try {
    const params = new URLSearchParams({
      q,
      format: 'jsonv2',
      limit: '5',
      countrycodes: 'dz',
      addressdetails: '1'
    })
    if (options.near) {
      const d = 0.25
      params.set(
        'viewbox',
        [options.near.lng - d, options.near.lat + d, options.near.lng + d, options.near.lat - d].join(',')
      )
      params.set('bounded', '1')
    }

    const data = await throttle(async () => {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
        signal: options.signal,
        headers: { Accept: 'application/json' }
      })
      if (!response.ok) throw new Error(`nominatim ${response.status}`)
      return (await response.json()) as NominatimResult[]
    })
    if (options.signal?.aborted) return { ok: false, error: 'تم إلغاء البحث.', kind: 'aborted' }

    const results: RemotePlace[] = []
    for (const item of data) {
      const lat = Number(item.lat)
      const lng = Number(item.lon)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
      const label = item.display_name.split(',').slice(0, 2).join(', ').trim()
      results.push({
        id: `osm-${item.place_id}`,
        nameAr: label || 'نتيجة من الخريطة',
        nameFr: label,
        kind: 'street',
        source: 'osm',
        lat,
        lng,
        displayName: item.display_name
      })
    }

    if (!results.length) return { ok: false, error: 'لم نجد نتائج مطابقة. جرّب صياغة أخرى أو حدّد الموقع على الخريطة.', kind: 'empty' }
    return { ok: true, results }
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') return { ok: false, error: 'تم إلغاء البحث.', kind: 'aborted' }
    return { ok: false, error: 'تعذّر البحث في OpenStreetMap. تحقّق من الاتصال أو حدّد الموقع على الخريطة.', kind: 'unavailable' }
  }
}
