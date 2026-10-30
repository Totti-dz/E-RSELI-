export type LatLng = { lat: number; lng: number }

/** Sougueur, Tiaret — resolved from OpenStreetMap (35.1856739, 1.4960929). */
export const MAP_CENTER: LatLng = { lat: 35.185674, lng: 1.496093 }

export type ServiceArea = {
  code: string
  nameAr: string
  wilaya: string
  center: LatLng
  radiusM: number
}

/**
 * Acceptance zone. This mirrors the service_areas seed planned for the
 * database migration; changing it here only changes the client-side check.
 * The server-side check (once the migration is applied) is authoritative.
 * The 8 km radius is an operational choice, NOT the administrative boundary.
 */
export const SERVICE_AREA: ServiceArea = {
  code: 'sougueur-tiaret',
  nameAr: 'السوقر',
  wilaya: 'تيارت',
  center: MAP_CENTER,
  radiusM: 8000
}

/**
 * Tiles are switchable. The public OSM tile server is acceptable for
 * development and low traffic only; production needs a dedicated provider.
 */
export type TileProvider = { id: string; url: string; attribution: string; maxZoom: number }

export const TILE_PROVIDERS: Record<string, TileProvider> = {
  osm: {
    id: 'osm',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
    maxZoom: 19
  }
}

export const ACTIVE_TILE_PROVIDER: TileProvider =
  TILE_PROVIDERS[(import.meta.env.VITE_TILE_PROVIDER as string) || 'osm'] ?? TILE_PROVIDERS.osm

/**
 * Driving-route lookup. Off by default so the UI never pretends a public
 * demo endpoint is a production routing service. Set VITE_ROUTING_ENABLED=1
 * to allow an explicit request; callers must still handle failure.
 */
export const ROUTING_ENABLED = import.meta.env.VITE_ROUTING_ENABLED === '1'

export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6371000
  const toRad = (v: number) => (v * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function isInsideServiceArea(point: LatLng, area: ServiceArea = SERVICE_AREA): boolean {
  return haversineMeters(point, area.center) <= area.radiusM
}
