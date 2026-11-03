import type { LatLng } from './geo/config'
import type { ServiceId } from './services'

/**
 * Last few orders kept on this device only (localStorage), so a returning
 * customer can repeat a route with one tap. Nothing here is sent to the server
 * and no phone number or name is stored.
 */
const KEY = 'ersel.recent.v1'
const MAX = 4
const SERVICES: ServiceId[] = ['food', 'parcel', 'shopping', 'business']

export type RecentOrder = {
  service: ServiceId
  pickupText: string
  dropoffText: string
  pickup: LatLng
  dropoff: LatLng
  details: string
  vehicle: 'motorcycle' | 'car'
  at: number
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const isPoint = (value: unknown): value is LatLng => {
  const p = value as Partial<LatLng> | null
  return !!p && finite(p.lat) && finite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180
}

function isRecent(value: unknown): value is RecentOrder {
  const r = value as Partial<RecentOrder> | null
  return !!r
    && SERVICES.includes(r.service as ServiceId)
    && typeof r.pickupText === 'string' && r.pickupText.trim().length >= 3
    && typeof r.dropoffText === 'string' && r.dropoffText.trim().length >= 3
    && isPoint(r.pickup) && isPoint(r.dropoff)
    && typeof r.details === 'string'
    && (r.vehicle === 'motorcycle' || r.vehicle === 'car')
    && finite(r.at)
}

export function loadRecent(storage: StorageLike | null = defaultStorage()): RecentOrder[] {
  if (!storage) return []
  try {
    const parsed: unknown = JSON.parse(storage.getItem(KEY) || '[]')
    return Array.isArray(parsed) ? parsed.filter(isRecent).slice(0, MAX) : []
  } catch {
    return []
  }
}

const sameRoute = (a: Pick<RecentOrder, 'service' | 'pickupText' | 'dropoffText'>, b: typeof a) =>
  a.service === b.service
  && a.pickupText.trim().toLowerCase() === b.pickupText.trim().toLowerCase()
  && a.dropoffText.trim().toLowerCase() === b.dropoffText.trim().toLowerCase()

export function saveRecent(
  entry: Omit<RecentOrder, 'at'>,
  storage: StorageLike | null = defaultStorage(),
  now: number = Date.now()
): RecentOrder[] {
  const next: RecentOrder = {
    ...entry,
    pickupText: entry.pickupText.trim().slice(0, 120),
    dropoffText: entry.dropoffText.trim().slice(0, 120),
    details: entry.details.trim().slice(0, 300),
    at: now
  }
  if (!isRecent(next)) return loadRecent(storage)
  const list = [next, ...loadRecent(storage).filter(item => !sameRoute(item, next))].slice(0, MAX)
  try {
    storage?.setItem(KEY, JSON.stringify(list))
  } catch {
    /* storage full or blocked: the feature simply does nothing */
  }
  return list
}

export function clearRecent(storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
