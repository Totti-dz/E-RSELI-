import { useEffect } from 'react'
import {
  bindNotificationTaps, onAppResume, registerPush, watchNotificationInbox, type InboxItem
} from '../lib/notifications'

type Options = {
  userId: string | null
  /** Tapping a notification opens that order. */
  onOpenOrder: (orderId: string) => void
  /** Live unread badge for the bell. */
  onUnread?: (count: number) => void
  /** Staff desks refresh their list when a new order arrives. */
  onNewOrder?: () => void
  /** Chat threads refresh when a message notification arrives. */
  onMessage?: (item: InboxItem) => void
}

/**
 * Wires the notification pipeline for the signed-in account:
 *
 *  - deep links from notification taps,
 *  - optional FCM registration (only when the build opted in),
 *  - the inbox watcher that raises a local notification (with sound) for every
 *    new database notification: a new order for the whole staff, a status change
 *    for the customer, a chat message for the other party.
 *
 * A no-op when signed out. The OS permission is checked before every alert, so
 * nothing is shown if the user has not enabled notifications.
 */
export function useOrderNotifications({ userId, onOpenOrder, onUnread, onNewOrder, onMessage }: Options) {
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

    let stopResume: (() => void) | undefined
    void onAppResume(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    }).then(fn => { stopResume = fn })

    const stopWatcher = watchNotificationInbox(
      item => {
        if (item.kind === 'new_order') onNewOrder?.()
        if (item.kind === 'message') onMessage?.(item)
        if (item.kind === 'status') onNewOrder?.()
      },
      count => onUnread?.(count)
    )

    return () => {
      stopWatcher()
      stopResume?.()
    }
    // Callbacks are intentionally excluded: they are recreated on each render and
    // would restart the poller. The watcher reads them through the closure of the
    // first mount, which is fine because they only dispatch state updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])
}
