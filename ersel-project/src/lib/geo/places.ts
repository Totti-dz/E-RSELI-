import type { LatLng } from './config'

export type PlaceKind = 'neighbourhood' | 'market' | 'street' | 'center'

export type Place = LatLng & {
  id: string
  nameAr: string
  nameFr: string
  kind: PlaceKind
  /** Where the coordinates come from. Only verified sources belong here. */
  source: 'osm'
}

/**
 * Verified local landmarks in Sougueur (OpenStreetMap nodes/ways).
 * These are NOT an official administrative list of neighbourhoods and
 * do not claim to be exhaustive. Add new verified entries here.
 *
 * NOTE: "حي الأمير عبد القادر" was searched and NOT found in OSM, so it is
 * intentionally absent rather than invented.
 */
export const LOCAL_PLACES: Place[] = [
  { id: 'sougueur-center', nameAr: 'وسط السوقر', nameFr: 'Centre Sougueur', kind: 'center', source: 'osm', lat: 35.185674, lng: 1.496093 },
  { id: 'cite-3', nameAr: 'المرحلة الثالثة', nameFr: 'Cité 3 (El Marhala)', kind: 'neighbourhood', source: 'osm', lat: 35.180265, lng: 1.499844 },
  { id: 'cite-koweit', nameAr: 'حي الكويت', nameFr: 'Cité Koweit', kind: 'neighbourhood', source: 'osm', lat: 35.186382, lng: 1.49063 },
  { id: 'nadour', nameAr: 'حي النضور', nameFr: 'Nadour', kind: 'neighbourhood', source: 'osm', lat: 35.192989, lng: 1.502004 },
  { id: 'souk-sougueur', nameAr: 'سوق السوقر', nameFr: 'Souk Sougueur', kind: 'market', source: 'osm', lat: 35.18449, lng: 1.499811 },
  { id: 'souk-si-abdelghani', nameAr: 'سوق سي عبد الغني', nameFr: 'Souk Si Abdelghani', kind: 'market', source: 'osm', lat: 35.180176, lng: 1.512533 },
  { id: 'rue-ibn-badis', nameAr: 'شارع ابن باديس', nameFr: 'Rue Ibn Badis', kind: 'street', source: 'osm', lat: 35.18579, lng: 1.498269 }
]

const AR_DIACRITICS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g

export function normalizeText(input: string): string {
  return input
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(AR_DIACRITICS, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

export function searchPlaces(query: string, limit = 6): Place[] {
  const q = normalizeText(query)
  if (q.length < 2) return []
  const tokens = q.split(' ').filter(Boolean)
  const scored = LOCAL_PLACES.map(place => {
    const ar = normalizeText(place.nameAr)
    const fr = normalizeText(place.nameFr)
    let score = 0
    if (ar === q || fr === q) score += 100
    if (ar.startsWith(q) || fr.startsWith(q)) score += 40
    for (const token of tokens) {
      if (ar.includes(token) || fr.includes(token)) score += 10
    }
    if (ar.includes(q) || fr.includes(q)) score += 15
    return { place, score }
  })
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
  return scored.map(entry => entry.place)
}

/** Marker label for a chosen coordinate. */
export function describePoint(point: LatLng, fallback = 'موقع محدد على الخريطة'): string {
  const near = LOCAL_PLACES
    .map(place => ({ place, d: Math.hypot((place.lat - point.lat) * 111320, (place.lng - point.lng) * 111320 * Math.cos((point.lat * Math.PI) / 180)) }))
    .sort((a, b) => a.d - b.d)[0]
  if (near && near.d <= 250) return near.place.nameAr
  return fallback
}

export function formatCoords(point: LatLng): string {
  return `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`
}
