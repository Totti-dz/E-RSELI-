import { useEffect } from 'react'
import {
  bindNotificationTaps, notificationsEnabled, onAppResume, registerPush, watchMyOrders
} from '../lib/notifications'

/**
 * Wires the Android notification pipeline for the signed-in customer:
 * deep links from taps, optional FCM registration, and the local watcher that
 * raises a notification (with sound) whenever one of their orders changes state.
 *
 * All of it is a no-op on the web without permission, and a no-op entirely when
 * the customer has not enabled notifications.
 */
export function useOrderNotifications(userId: string | null, onOpenOrder: (orderId: string) => void) {
  useEffect(() => {
    let dispose: (() => void) | undefined
    let cancelled = false
    void bindNotificationTaps(onOpenOrder).then(fn => {
      if (cancelled) fn()
      else dispose = fn
    })
    return () => {
      cancelled = true
      dispose?.()
    }
  }, [onOpenOrder])

  useEffect(() => {
    if (!userId) return
    void registerPush()
    if (!notificationsEnabled()) return

    const stopWatcher = watchMyOrders()
    let stopResume: (() => void) | undefined
    void onAppResume(() => { /* the watcher ticks on its own interval */ }).then(fn => { stopResume = fn })

    return () => {
      stopWatcher()
      stopResume?.()
    }
  }, [userId])
}
