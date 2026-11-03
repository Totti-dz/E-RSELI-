import { describe, expect, it } from 'vitest'
import { clearRecent, loadRecent, saveRecent } from '../recentOrders'

function fakeStorage(initial: Record<string, string> = {}) {
  const data = { ...initial }
  return {
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => { data[k] = v },
    removeItem: (k: string) => { delete data[k] },
    data
  }
}

const base = {
  service: 'parcel' as const,
  pickupText: 'حي النصر',
  dropoffText: 'السوق',
  pickup: { lat: 35.18, lng: 1.49 },
  dropoff: { lat: 35.19, lng: 1.5 },
  details: 'طرد صغير',
  vehicle: 'motorcycle' as const
}

describe('recentOrders', () => {
  it('saves and loads the latest order first', () => {
    const s = fakeStorage()
    saveRecent(base, s, 1)
    saveRecent({ ...base, dropoffText: 'المستشفى' }, s, 2)
    const list = loadRecent(s)
    expect(list.map(r => r.dropoffText)).toEqual(['المستشفى', 'السوق'])
  })

  it('moves a repeated route to the top instead of duplicating it', () => {
    const s = fakeStorage()
    saveRecent(base, s, 1)
    saveRecent({ ...base, dropoffText: 'المستشفى' }, s, 2)
    saveRecent({ ...base, pickupText: ' حي النصر ' }, s, 3)
    const list = loadRecent(s)
    expect(list).toHaveLength(2)
    expect(list[0].dropoffText).toBe('السوق')
    expect(list[0].at).toBe(3)
  })

  it('keeps at most four entries', () => {
    const s = fakeStorage()
    for (let i = 0; i < 7; i++) saveRecent({ ...base, dropoffText: `وجهة ${i}` }, s, i)
    expect(loadRecent(s)).toHaveLength(4)
    expect(loadRecent(s)[0].dropoffText).toBe('وجهة 6')
  })

  it('ignores corrupted or tampered storage', () => {
    expect(loadRecent(fakeStorage({ 'ersel.recent.v1': '{oops' }))).toEqual([])
    expect(loadRecent(fakeStorage({ 'ersel.recent.v1': '{"a":1}' }))).toEqual([])
    const bad = JSON.stringify([{ ...base, at: 1, pickup: { lat: 'x', lng: 1 } }, { ...base, at: 2, service: 'nope' }, { ...base, at: 3 }])
    expect(loadRecent(fakeStorage({ 'ersel.recent.v1': bad }))).toHaveLength(1)
  })

  it('rejects entries that are too short or have invalid coordinates', () => {
    const s = fakeStorage()
    saveRecent({ ...base, pickupText: 'ab' }, s, 1)
    saveRecent({ ...base, dropoff: { lat: 999, lng: 1 } }, s, 2)
    expect(loadRecent(s)).toEqual([])
  })

  it('works without any storage and can be cleared', () => {
    expect(loadRecent(null)).toEqual([])
    expect(saveRecent(base, null, 1)).toHaveLength(1)
    const s = fakeStorage()
    saveRecent(base, s, 1)
    clearRecent(s)
    expect(loadRecent(s)).toEqual([])
  })
})
