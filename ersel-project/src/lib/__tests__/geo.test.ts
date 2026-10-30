import { describe, expect, it } from 'vitest'
import { haversineMeters, isInsideServiceArea, MAP_CENTER, SERVICE_AREA } from '../geo/config'

describe('service area checks', () => {
  it('treats the centre as inside', () => {
    expect(isInsideServiceArea(MAP_CENTER)).toBe(true)
    expect(haversineMeters(MAP_CENTER, MAP_CENTER)).toBe(0)
  })

  it('accepts a point ~2 km from the centre', () => {
    const point = { lat: MAP_CENTER.lat + 0.018, lng: MAP_CENTER.lng } // ~2 km north
    expect(haversineMeters(point, MAP_CENTER)).toBeLessThan(SERVICE_AREA.radiusM)
    expect(isInsideServiceArea(point)).toBe(true)
  })

  it('rejects a point outside the 8 km radius', () => {
    const far = { lat: MAP_CENTER.lat + 0.09, lng: MAP_CENTER.lng } // ~10 km north
    expect(haversineMeters(far, MAP_CENTER)).toBeGreaterThan(SERVICE_AREA.radiusM)
    expect(isInsideServiceArea(far)).toBe(false)
  })

  it('uses a symmetric distance', () => {
    const a = { lat: 35.19, lng: 1.5 }
    const b = { lat: 35.2, lng: 1.51 }
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 6)
  })
})
