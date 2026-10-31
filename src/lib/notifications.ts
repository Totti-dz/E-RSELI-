import { Capacitor } from '@capacitor/core'
import { App as NativeApp } from '@capacitor/app'
import { LocalNotifications } from '@capacitor/local-notifications'
import { PushNotifications } from '@capacitor/push-notifications'
import { supabase } from './supabase'
import { STATUS_LABELS } from './myOrders'
import type { OrderStatus } from './staffOrders'

/**
 * Notification bridge for the Android build.
 *
 * Two independent paths, on purpose:
 *
 *  1. In-app inbox (`public.notifications`) + local notifications. The database
 *     broadcasts a row to every verified courier when an order is created, to the
 *     customer on every status change, and to the other side on every chat
 *     message. The app polls the inbox while running and raises a local
 *     notification with `res/raw/ersel_chime.wav`. No Firebase, no server key,
 *     works for the whole staff at once.
 *
 *  2. FCM push (optional, needs Firebase + the `notify-order` edge function).
 *     Delivers the same messages when the app is closed. Off unless
 *     `VITE_PUSH_ENABLED=true` at build time and `google-services.json` is
 *     present in `android/app/`.
 *
 * On the web both paths degrade to the browser Notification API, which the
 * browser plays with the system sound (a web page cannot ship its own tone).
 */

export const NOTIFICATION_CHANNEL = 'ersel_orders'
export const NOTIFICATION_SOUND = 'ersel_chime'

const PREF_KEY = 'ersel_notify_enabled_v1'
const SEEN_KEY = 'ersel_seen_notifications_v1'
const SEEN_LIMIT = 150
const POLL_INTERVAL_MS = 20_000
const PUSH_ENABLED = String(import.meta.env.VITE_PUSH_ENABLED || '').toLowerCase() === 'true'
const VAPID_PUBLIC_KEY = (import.meta.env.VITE_VAPID_PUBLIC_KEY || '').trim()

export type NotificationSupport = 'native' | 'web' | 'unsupported'

export type NotificationKind = 'new_order' | 'status' | 'message' | 'rating' | 'system'

export type InboxItem = {
  id: string
  kind: NotificationKind
  title: string
  body: string
  orderId: string | null
  createdAt: string
  readAt: string | null
}

export function notificationSupport(): NotificationSupport {
  if (Capacitor.isNativePlatform()) return 'native'
  if (typeof window !== 'undefined' && 'Notification' in window) return 'web'
  return 'unsupported'
}

export function isAndroidApp(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}

export function notificationsEnabled(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) === '1'
  } catch {
    return false
  }
}

/** Current permission as the OS reports it — never cached. */
export async function notificationPermission(): Promise<'granted' | 'denied' | 'prompt'> {
  const support = notificationSupport()
  if (support === 'native') {
    const status = await LocalNotifications.checkPermissions()
    return status.display === 'granted' ? 'granted' : status.display === 'denied' ? 'denied' : 'prompt'
  }
  if (support === 'web') {
    if (Notification.permission === 'granted') return 'granted'
    return Notification.permission === 'denied' ? 'denied' : 'prompt'
  }
  return 'denied'
}

/**
 * Creates the Android channel once. The sound must be attached to the channel,
 * not only to the message: from Android 8 the channel owns the tone, and a
 * channel cannot change its sound after creation — hence the versioned id.
 */
async function ensureChannel(): Promise<void> {
  if (!isAndroidApp()) return
  try {
    await LocalNotifications.createChannel({
      id: NOTIFICATION_CHANNEL,
      name: 'تحديثات الطلبات',
      description: 'طلب جديد، حالة الطلب، رسالة من الزبون أو الموصّل',
      importance: 5, // IMPORTANCE_HIGH → heads-up + sound
      visibility: 1,
      sound: NOTIFICATION_SOUND,
      vibration: true,
      lights: true,
      lightColor: '#0eb8eb'
    })
  } catch (error) {
    console.warn('[ERSEL] تعذّر إنشاء قناة الإشعارات', error)
  }
}

/** Asks for the OS permission and creates the channel. Returns the final grant. */
export async function requestNotifications(): Promise<'granted' | 'denied' | 'prompt' | 'unsupported'> {
  const support = notificationSupport()
  if (support === 'unsupported') return 'unsupported'

  if (support === 'native') {
    await ensureChannel()
    const status = await LocalNotifications.requestPermissions()
    return status.display === 'granted' ? 'granted' : 'denied'
  }

  const result = await Notification.requestPermission()
  return result === 'granted' ? 'granted' : result === 'denied' ? 'denied' : 'prompt'
}

export async function setNotificationsEnabled(enabled: boolean): Promise<void> {
  try {
    localStorage.setItem(PREF_KEY, enabled ? '1' : '0')
  } catch {
    /* private mode: keep the in-memory behaviour only */
  }
  if (enabled) await ensureChannel()
}

/** Small demo notification, used by the settings card so the sound can be heard. */
export async function sendTestNotification(): Promise<{ ok: true } | { ok: false; error: string }> {
  const permission = await notificationPermission()
  if (permission !== 'granted') {
    return { ok: false, error: 'الإشعارات غير مسموح بها من إعدادات الهاتف.' }
  }

  if (isAndroidApp()) {
    await ensureChannel()
    await LocalNotifications.schedule({
      notifications: [{
        id: 1,
        title: 'ERSEL — تجربة الإشعار',
        body: 'هكذا سيصلك تنبيه عند وصول طلب جديد أو رسالة، بهذا الصوت.',
        channelId: NOTIFICATION_CHANNEL,
        sound: NOTIFICATION_SOUND,
        smallIcon: 'ic_stat_ersel',
        iconColor: '#0b1f45',
        schedule: { at: new Date(Date.now() + 600) }
      }]
    })
    return { ok: true }
  }

  if (notificationSupport() === 'web') {
    new Notification('ERSEL — تجربة الإشعار', {
      body: 'هكذا سيصلك تنبيه عند وصول طلب جديد أو رسالة.',
      icon: '/brand/icon-192.png',
      tag: 'ersel-test'
    })
    return { ok: true }
  }

  return { ok: false, error: 'هذا الجهاز لا يدعم الإشعارات.' }
}

/** Stable 31-bit id for a string, so the same order reuses the same notification slot. */
function notificationId(key: string): number {
  let hash = 0
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0
  }
  return Math.abs(hash) % 2_000_000_000 || 1
}

async function presentNotification(title: string, body: string, key: string, orderId: string | null): Promise<void> {
  if (!notificationsEnabled()) return
  if (await notificationPermission() !== 'granted') return

  if (isAndroidApp()) {
    await ensureChannel()
    await LocalNotifications.schedule({
      notifications: [{
        id: notificationId(key),
        title,
        body,
        channelId: NOTIFICATION_CHANNEL,
        sound: NOTIFICATION_SOUND,
        smallIcon: 'ic_stat_ersel',
        iconColor: '#0b1f45',
        schedule: { at: new Date(Date.now() + 300) },
        extra: { orderId: orderId || '', notificationId: key }
      }]
    })
    return
  }

  if (notificationSupport() === 'web') {
    const notification = new Notification(title, {
      body,
      icon: '/brand/icon-192.png',
      tag: `ersel-${key}`
    })
    notification.onclick = () => {
      if (orderId) {
        window.dispatchEvent(new CustomEvent('ersel:open-order', { detail: { orderId } }))
      }
      notification.close()
    }
  }
}

/* ------------------------------------------------------------------ */
/* Inbox                                                              */
/* ------------------------------------------------------------------ */

function readSeen(): string[] | null {
  try {
    const raw = localStorage.getItem(SEEN_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String) : null
  } catch {
    return null
  }
}

function writeSeen(ids: string[]): void {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(ids.slice(-SEEN_LIMIT)))
  } catch {
    /* private mode */
  }
}

function asItem(row: Record<string, unknown>): InboxItem {
  return {
    id: String(row.id),
    kind: (row.kind as NotificationKind) || 'system',
    title: String(row.title || ''),
    body: String(row.body || ''),
    orderId: row.order_id ? String(row.order_id) : null,
    createdAt: String(row.created_at || ''),
    readAt: row.read_at ? String(row.read_at) : null
  }
}

export async function loadNotificationInbox(limit = 25): Promise<InboxItem[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('notifications')
    .select('id,kind,title,body,order_id,created_at,read_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) return []
  return ((data ?? []) as unknown as Record<string, unknown>[]).map(asItem)
}

export async function unreadNotificationCount(): Promise<number> {
  if (!supabase) return 0
  const { data, error } = await supabase.rpc('unread_notification_count')
  if (error) return 0
  return Number(data) || 0
}

export async function markNotificationsRead(ids?: string[]): Promise<void> {
  if (!supabase) return
  try {
    await supabase.rpc('mark_notifications_read', { p_ids: ids && ids.length ? ids : null })
  } catch {
    /* cosmetic */
  }
}

/**
 * Polls the inbox and raises a notification for every item this device has not
 * shown yet. The first run only seeds the baseline, so signing in does not fire
 * a notification storm for the whole history.
 *
 * Returns a stop function and exposes the unread count through `onUnread`.
 */
export function watchNotificationInbox(
  onItem: (item: InboxItem) => void,
  onUnread: (count: number) => void
): () => void {
  let stopped = false
  let timer: number | null = null
  let seeded = false

  const tick = async () => {
    if (stopped || !supabase) return
    if (document.visibilityState === 'hidden' && !Capacitor.isNativePlatform()) return

    const { data, error } = await supabase
      .from('notifications')
      .select('id,kind,title,body,order_id,created_at,read_at')
      .order('created_at', { ascending: false })
      .limit(20)
    if (error || !data) return

    const items = (data as unknown as Record<string, unknown>[]).map(asItem)
    const stored = readSeen()

    if (!seeded) {
      seeded = true
      if (stored === null) {
        // First launch on this device: remember what is already there silently.
        writeSeen(items.map(item => item.id))
      }
    }

    const seen = new Set(stored ?? readSeen() ?? [])
    const fresh: InboxItem[] = []
    for (const item of items) {
      if (seen.has(item.id)) continue
      seen.add(item.id)
      fresh.push(item)
    }

    if (fresh.length) {
      writeSeen(Array.from(seen))
      for (const item of fresh.reverse()) {
        await presentNotification(item.title, item.body, item.id, item.orderId)
        onItem(item)
      }
    }

    const unread = await unreadNotificationCount()
    if (!stopped) onUnread(unread)
  }

  void tick()
  timer = window.setInterval(() => { void tick() }, POLL_INTERVAL_MS)

  const onVisible = () => {
    if (document.visibilityState === 'visible') void tick()
  }
  document.addEventListener('visibilitychange', onVisible)

  let channel: ReturnType<NonNullable<typeof supabase>['channel']> | null = null
  if (supabase) {
    channel = supabase
      .channel('ersel-inbox')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications' },
        () => { void tick() }
      )
      .subscribe()
  }

  return () => {
    stopped = true
    if (timer !== null) window.clearInterval(timer)
    document.removeEventListener('visibilitychange', onVisible)
    if (channel && supabase) void supabase.removeChannel(channel)
  }
}

/* ------------------------------------------------------------------ */
/* Legacy order watcher (kept for builds without migration 14)        */
/* ------------------------------------------------------------------ */

type NotifiableOrder = {
  id: string
  order_code: string
  pickup: string
  dropoff: string
  price_dzd: number
}

function orderTitle(order: NotifiableOrder, status: OrderStatus): string {
  return `طلب ${order.order_code || ''} · ${STATUS_LABELS[status]}`.trim()
}

function orderBody(order: NotifiableOrder, status: OrderStatus): string {
  const route = [order.pickup, order.dropoff].filter(Boolean).join(' ← ')
  const price = order.price_dzd ? ` · ${order.price_dzd} دج` : ''
  return status === 'delivered'
    ? `تم تسليم ${route}${price}. شكرًا لاستخدامك ERSEL.`
    : `${route}${price}`
}

export function orderNotificationText(order: NotifiableOrder, status: OrderStatus): { title: string; body: string } {
  return { title: orderTitle(order, status), body: orderBody(order, status) }
}

/* ------------------------------------------------------------------ */
/* Deep links                                                         */
/* ------------------------------------------------------------------ */

/** Deep link handler: taps on a local notification or an FCM message. */
export async function bindNotificationTaps(onOpenOrder: (orderId: string) => void): Promise<() => void> {
  const cleanups: Array<() => void> = []

  if (Capacitor.isNativePlatform()) {
    const localTap = await LocalNotifications.addListener('localNotificationActionPerformed', (event) => {
      const orderId = String(event.notification.extra?.orderId || '')
      if (orderId) onOpenOrder(orderId)
    })
    cleanups.push(() => { void localTap.remove() })

    const pushTap = await PushNotifications.addListener('pushNotificationActionPerformed', (event) => {
      const orderId = String(event.notification.data?.orderId || '')
      if (orderId) onOpenOrder(orderId)
    })
    cleanups.push(() => { void pushTap.remove() })
  }

  const onWebEvent = (event: Event) => {
    const detail = (event as CustomEvent<{ orderId?: string }>).detail
    if (detail?.orderId) onOpenOrder(detail.orderId)
  }
  window.addEventListener('ersel:open-order', onWebEvent)
  cleanups.push(() => window.removeEventListener('ersel:open-order', onWebEvent))

  return () => cleanups.forEach(fn => fn())
}

/**
 * Optional FCM registration. Silent no-op unless the build opted in, so a fork
 * without Firebase still ships a working APK.
 */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const binary = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function registerWebPush(): Promise<void> {
  if (!PUSH_ENABLED || !supabase || !('serviceWorker' in navigator) || !VAPID_PUBLIC_KEY) return
  if (Capacitor.isNativePlatform()) return
  try {
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') return
    const registration = await navigator.serviceWorker.ready
    let subscription = await registration.pushManager.getSubscription()
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      })
    }
    const token = JSON.stringify(subscription)
    if (token.length < 20) return
    const { error } = await supabase.rpc('register_device_token', {
      p_token: token,
      p_platform: 'web',
      p_app_version: APP_VERSION_FOR_TOKEN()
    })
    if (error) console.warn('[ERSEL] تعذّر تسجيل اشتراك الويب', error.message)
  } catch (error) {
    console.warn('[ERSEL] Web Push غير مهيّأ', error)
  }
}

function APP_VERSION_FOR_TOKEN(): string | null {
  return (typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : null)
}

/**
 * Optional FCM (Android) / Web Push (PWA) registration.
 * Silent no-op unless the build opted in, so a fork without Firebase still ships.
 */
export async function registerPush(): Promise<void> {
  if (!PUSH_ENABLED || !supabase) return

  if (!Capacitor.isNativePlatform()) {
    await registerWebPush()
    return
  }

  try {
    let permission = await PushNotifications.checkPermissions()
    if (permission.receive === 'prompt') {
      permission = await PushNotifications.requestPermissions()
    }
    if (permission.receive !== 'granted') return

    await PushNotifications.addListener('registration', (token) => {
      void supabase!
        .rpc('register_device_token', {
          p_token: token.value,
          p_platform: Capacitor.getPlatform(),
          p_app_version: APP_VERSION_FOR_TOKEN()
        })
        .then(({ error }) => {
          if (error) console.warn('[ERSEL] تعذّر تسجيل رمز الجهاز', error.message)
        })
    })

    await PushNotifications.addListener('registrationError', (error) => {
      console.warn('[ERSEL] فشل تسجيل الإشعارات (تحقّق من google-services.json)', error)
    })

    await PushNotifications.addListener('pushNotificationReceived', (notification) => {
      const orderId = String(notification.data?.orderId || '')
      const status = String(notification.data?.status || '') as OrderStatus
      const title = String(notification.data?.title || notification.title || 'ERSEL')
      const body = String(notification.data?.body || notification.body || '')
      if (!orderId && !title) return
      void presentNotification(
        title,
        body || (STATUS_LABELS[status] || ''),
        `${orderId}:${Date.now()}`,
        orderId || null
      )
    })

    await PushNotifications.register()
  } catch (error) {
    console.warn('[ERSEL] الإشعارات الفورية غير مهيّأة', error)
  }
}

/** Keeps the WebView bridge warm: Capacitor pauses timers when backgrounded. */
export async function onAppResume(callback: () => void): Promise<() => void> {
  if (!Capacitor.isNativePlatform()) return () => {}
  const listener = await NativeApp.addListener('appStateChange', (state) => {
    if (state.isActive) callback()
  })
  return () => { void listener.remove() }
}
