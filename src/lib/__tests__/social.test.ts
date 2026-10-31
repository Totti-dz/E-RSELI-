import { describe, expect, it } from 'vitest'
import { canCourierConfirm, canCustomerConfirm, canRateOrder } from '../delivery'
import { canChat } from '../myOrders'
import { formatWeekStart, isCurrentWeek } from '../staffStats'
import { avatarInitials } from '../profile'

describe('dual delivery confirmation', () => {
  it('lets the customer confirm once a courier is assigned', () => {
    expect(canCustomerConfirm({ status: 'accepted', courierId: 'c1', customerConfirmed: false })).toBe(true)
    expect(canCustomerConfirm({ status: 'delivered', courierId: 'c1', customerConfirmed: false })).toBe(true)
  })

  it('refuses without a courier, after cancelling, or twice', () => {
    expect(canCustomerConfirm({ status: 'pending', courierId: null, customerConfirmed: false })).toBe(false)
    expect(canCustomerConfirm({ status: 'cancelled', courierId: 'c1', customerConfirmed: false })).toBe(false)
    expect(canCustomerConfirm({ status: 'delivered', courierId: 'c1', customerConfirmed: true })).toBe(false)
  })

  it('lets the courier confirm only from the road', () => {
    expect(canCourierConfirm({ status: 'picked_up', courierConfirmed: false })).toBe(true)
    expect(canCourierConfirm({ status: 'in_transit', courierConfirmed: false })).toBe(true)
    expect(canCourierConfirm({ status: 'pending', courierConfirmed: false })).toBe(false)
    expect(canCourierConfirm({ status: 'in_transit', courierConfirmed: true })).toBe(false)
  })
})

describe('rating rules', () => {
  const base = { status: 'delivered', customerConfirmed: true, courierId: 'c1', alreadyRated: false }

  it('opens only after the customer confirmed receipt', () => {
    expect(canRateOrder(base)).toBe(true)
    expect(canRateOrder({ ...base, customerConfirmed: false })).toBe(false)
    expect(canRateOrder({ ...base, status: 'in_transit' })).toBe(false)
  })

  it('refuses a second rating and orders without a courier', () => {
    expect(canRateOrder({ ...base, alreadyRated: true })).toBe(false)
    expect(canRateOrder({ ...base, courierId: null })).toBe(false)
  })
})

describe('chat availability', () => {
  it('needs an assigned courier on a live order', () => {
    expect(canChat({ courier_id: 'c1', status: 'accepted' })).toBe(true)
    expect(canChat({ courier_id: null, status: 'accepted' })).toBe(false)
    expect(canChat({ courier_id: 'c1', status: 'pending' })).toBe(false)
    expect(canChat({ courier_id: 'c1', status: 'cancelled' })).toBe(false)
  })
})

describe('weekly buckets', () => {
  it('labels a week start in Arabic', () => {
    expect(formatWeekStart('2026-10-26')).toBe('26 أكتوبر')
    expect(formatWeekStart('')).toBe('—')
  })

  it('recognises the Monday-based current week', () => {
    // Friday 30 October 2026 → week starts Monday 26 October.
    expect(isCurrentWeek('2026-10-26', new Date(2026, 9, 30))).toBe(true)
    expect(isCurrentWeek('2026-10-19', new Date(2026, 9, 30))).toBe(false)
    // Sunday still belongs to the week that started on Monday.
    expect(isCurrentWeek('2026-10-26', new Date(2026, 10, 1))).toBe(true)
  })
})

describe('avatar initials', () => {
  it('takes the first letters of Arabic and Latin names', () => {
    expect(avatarInitials('أحمد بن علي')).toBe('أع')
    expect(avatarInitials('Yacine')).toBe('Ya')
    expect(avatarInitials('')).toBe('؟')
  })
})
