import { ROUTING_ENABLED } from './geo/config'

/**
 * Client-side *suggestion* only. The authoritative formula lives in the
 * database: public.suggest_price_dzd(p_distance_m) in supabase/ersel_v2.sql
 * (100 DZD covers the first km, +30 DZD per extra km, rounded to 10, min 100).
 * Keeping both in sync avoids showing the customer a number the server would
 * never produce.
 *
 * It is still only a suggestion: the customer proposes the price and the
 * server stores that proposal. Nothing here is a tariff.
 */
export const SUGGESTED_PRICING = {
  baseDzd: 100,
  perKmAfterFirstDzd: 30,
  includedKm: 1,
  minDzd: 100,
  stepDzd: 10
} as const

/** Pure formula — mirrors public.suggest_price_dzd() in the database. */
export function computeSuggestedPrice(distanceM: number): number | null {
  if (!Number.isFinite(distanceM) || distanceM <= 0) return null
  const km = distanceM / 1000
  const extraKm = Math.max(km - SUGGESTED_PRICING.includedKm, 0)
  const raw = SUGGESTED_PRICING.baseDzd + extraKm * SUGGESTED_PRICING.perKmAfterFirstDzd
  const stepped = Math.round(raw / SUGGESTED_PRICING.stepDzd) * SUGGESTED_PRICING.stepDzd
  return Math.max(SUGGESTED_PRICING.minDzd, stepped)
}

/**
 * Shown only when a real driving route is available (VITE_ROUTING_ENABLED=1
 * and the routing request succeeded).
 */
export function suggestPriceFromRouteMeters(distanceM: number): number | null {
  if (!ROUTING_ENABLED) return null
  return computeSuggestedPrice(distanceM)
}
