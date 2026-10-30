import { ROUTING_ENABLED, type LatLng } from './config'

export type RouteResult =
  | { ok: true; geometry: [number, number][]; distanceM: number; durationS: number }
  | { ok: false; error: string; kind: 'offline' | 'unavailable' | 'empty' }

/** Public OSRM demo. Fine for development; production should use a dedicated instance. */
export const ROUTING_ENDPOINT = 'https://router.project-osrm.org/route/v1/driving'

let lastAt = 0

export async function fetchDrivingRoute(from: LatLng, to: LatLng): Promise<RouteResult> {
  if (!ROUTING_ENABLED) {
    return { ok: false, error: 'حساب مسار القيادة غير مفعّل في هذه النسخة.', kind: 'unavailable' }
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { ok: false, error: 'لا يوجد اتصال بالإنترنت.', kind: 'offline' }
  }
  const wait = 1100 - (Date.now() - lastAt)
  if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait))
  lastAt = Date.now()

  const url = `${ROUTING_ENDPOINT}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`
  try {
    const response = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!response.ok) {
      return { ok: false, error: 'تعذّر حساب مسار القيادة من الخدمة المتاحة.', kind: 'unavailable' }
    }
    const data = await response.json() as {
      code?: string
      routes?: { distance: number; duration: number; geometry?: { coordinates: [number, number][] } }[]
    }
    const route = data.routes?.[0]
    const coords = route?.geometry?.coordinates
    if (data.code !== 'Ok' || !route || !coords?.length) {
      return { ok: false, error: 'لا يوجد مسار قيادة بين النقطتين في بيانات الطريق المتاحة.', kind: 'empty' }
    }
    return {
      ok: true,
      geometry: coords,
      distanceM: route.distance,
      durationS: route.duration
    }
  } catch {
    return { ok: false, error: 'تعذّر الاتصال بخدمة التوجيه.', kind: 'unavailable' }
  }
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} م`
  return `${(meters / 1000).toFixed(1)} كم`
}

export function formatDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60))
  if (minutes < 60) return `${minutes} د`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} س ${rest} د` : `${hours} س`
}
