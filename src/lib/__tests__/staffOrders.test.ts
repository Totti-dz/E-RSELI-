import { describe, expect, it } from 'vitest'
import {
  adminForwardStatuses, canAdminCancel, isUnclaimedJob,
  NEXT_STATUS, STATUS_ACTION_LABEL, type OrderStatus, type StaffOrder
} from '../staffOrders'

const order = (patch: Partial<StaffOrder> = {}): StaffOrder => ({
  id: 'o1',
  service: 'parcel',
  customer_name: 'زبون',
  phone: '+213551234567',
  pickup: 'السوقر',
  dropoff: 'تيارت',
  details: '',
  notes: '',
  vehicle: 'motorcycle',
  status: 'pending',
  price_dzd: 150,
  courier_id: null,
  customer_id: null,
  pickup_lat: null,
  pickup_lng: null,
  dropoff_lat: null,
  dropoff_lng: null,
  created_at: '2026-10-29T10:00:00Z',
  updated_at: null,
  ...patch
})

describe('order status chain', () => {
  it('follows the only allowed forward chain', () => {
    expect(NEXT_STATUS.pending).toBe('accepted')
    expect(NEXT_STATUS.accepted).toBe('picked_up')
    expect(NEXT_STATUS.picked_up).toBe('in_transit')
    expect(NEXT_STATUS.in_transit).toBe('delivered')
  })

  it('has no automatic step after delivered or cancelled', () => {
    expect(NEXT_STATUS.delivered).toBeUndefined()
    expect(NEXT_STATUS.cancelled).toBeUndefined()
    expect(adminForwardStatuses('delivered')).toEqual([])
    expect(adminForwardStatuses('cancelled')).toEqual([])
  })

  it('offers exactly one forward action at a time', () => {
    const statuses: OrderStatus[] = ['pending', 'accepted', 'picked_up', 'in_transit']
    for (const status of statuses) {
      expect(adminForwardStatuses(status)).toHaveLength(1)
      expect(STATUS_ACTION_LABEL[status]).toBeTruthy()
    }
  })

  it('never lets the UI jump backwards or skip a step', () => {
    expect(adminForwardStatuses('pending')).not.toContain('delivered')
    expect(adminForwardStatuses('in_transit')).not.toContain('pending')
  })
})

describe('admin cancellation rules', () => {
  it('allows cancelling anything that is not finished', () => {
    expect(canAdminCancel('pending')).toBe(true)
    expect(canAdminCancel('accepted')).toBe(true)
    expect(canAdminCancel('picked_up')).toBe(true)
    expect(canAdminCancel('in_transit')).toBe(true)
  })

  it('refuses to cancel a delivered or already cancelled order', () => {
    expect(canAdminCancel('delivered')).toBe(false)
    expect(canAdminCancel('cancelled')).toBe(false)
  })
})

describe('unclaimed jobs', () => {
  it('is only a pending order without a courier', () => {
    expect(isUnclaimedJob(order())).toBe(true)
    expect(isUnclaimedJob(order({ courier_id: 'c1' }))).toBe(false)
    expect(isUnclaimedJob(order({ status: 'accepted' }))).toBe(false)
  })
})
