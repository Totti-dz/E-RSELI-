import { describe, expect, it } from 'vitest'
import { computeSuggestedPrice, SUGGESTED_PRICING } from '../pricing'

/**
 * These expectations mirror public.suggest_price_dzd(p_distance_m) in
 * supabase/ersel_v2.sql. If one side changes, this test must change too —
 * that is the point: the number the customer sees must match the server.
 */
describe('suggested price formula', () => {
  it('returns null for missing or invalid distances', () => {
    expect(computeSuggestedPrice(0)).toBeNull()
    expect(computeSuggestedPrice(-5)).toBeNull()
    expect(computeSuggestedPrice(Number.NaN)).toBeNull()
    expect(computeSuggestedPrice(Number.POSITIVE_INFINITY)).toBeNull()
  })

  it('charges the base price inside the first kilometre', () => {
    expect(computeSuggestedPrice(400)).toBe(100)
    expect(computeSuggestedPrice(1000)).toBe(100)
  })

  it('adds 30 DZD per extra kilometre', () => {
    expect(computeSuggestedPrice(2000)).toBe(130)
    expect(computeSuggestedPrice(3000)).toBe(160)
    expect(computeSuggestedPrice(5500)).toBe(240)
  })

  it('rounds to the nearest 10 and never goes below the minimum', () => {
    expect(computeSuggestedPrice(2500)).toBe(150)
    expect(computeSuggestedPrice(100)).toBe(SUGGESTED_PRICING.minDzd)
    expect(computeSuggestedPrice(1234)).toBe(110)
  })
})
