import { useCallback, useEffect, useState } from 'react'
import {
  Bell, BellRing, CheckCheck, Loader2, MessageCircle, PackagePlus, Star, Truck
} from 'lucide-react'
import {
  loadNotificationInbox, markNotificationsRead, type InboxItem, type NotificationKind
} from '../lib/notifications'
import { formatWhen } from '../lib/format'

type Props = {
  unread: number
  onUnreadChange: (count: number) => void
  onOpenOrder: (orderId: string) => void
}

const ICONS: Record<NotificationKind, typeof Bell> = {
  new_order: PackagePlus,
  status: Truck,
  message: MessageCircle,
  rating: Star,
  system: BellRing
}

/** Bell with an unread badge and a compact inbox sheet. */
export default function NotificationBell({ unread, onUnreadChange, onOpenOrder }: Props) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<InboxItem[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const rows = await loadNotificationInbox(30)
    setItems(rows)
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!open) return
    void load().then(() => {
      void markNotificationsRead()
      onUnreadChange(0)
    })
    // onUnreadChange is stable from the parent (useState setter wrapper).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, load])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  function pick(item: InboxItem) {
    setOpen(false)
    if (item.orderId) onOpenOrder(item.orderId)
  }

  return (
    <div className="notif">
      <button
        type="button"
        className={unread > 0 ? 'notif-button has-unread' : 'notif-button'}
        onClick={() => setOpen(value => !value)}
        aria-label={unread > 0 ? `الإشعارات (${unread} غير مقروء)` : 'الإشعارات'}
        aria-expanded={open}
      >
        <Bell size={17} />
        {unread > 0 && <span className="notif-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>

      {open && (
        <>
          <button type="button" className="notif-backdrop" aria-label="إغلاق" onClick={() => setOpen(false)} />
          <div className="notif-panel" role="dialog" aria-label="الإشعارات">
            <header className="notif-head">
              <b>الإشعارات</b>
              {loading && <Loader2 size={14} className="spin" />}
              <button type="button" className="notif-close" onClick={() => setOpen(false)} aria-label="إغلاق">
                <CheckCheck size={15} />
              </button>
            </header>

            {!loading && items.length === 0 ? (
              <p className="notif-empty">لا إشعارات بعد. سيصلك تنبيه عند وصول طلب جديد أو رسالة.</p>
            ) : (
              <ul className="notif-list">
                {items.map(item => {
                  const Icon = ICONS[item.kind] ?? Bell
                  return (
                    <li key={item.id}>
                      <button type="button" className={item.readAt ? 'notif-item' : 'notif-item unread'} onClick={() => pick(item)}>
                        <span className={`notif-icon kind-${item.kind}`}><Icon size={15} /></span>
                        <span className="notif-copy">
                          <b>{item.title}</b>
                          {item.body && <small>{item.body}</small>}
                          <time>{formatWhen(item.createdAt)}</time>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  )
}
