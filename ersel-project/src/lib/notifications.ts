import { Capacitor } from '@capacitor/core'
import { App as NativeApp } from '@capacitor/app'
import { LocalNotifications } from '@capacitor/local-notifications'
import { PushNotifications } from '@capacitor/push-notifications'
import { supabase } from './supabase'
import { STATUS_LABELS, loadMyOrders, type MyOrder } from './myOrders'
import type { OrderStatus } from './staffOrders'

/**
 * Notification bridge for the Android build.
 *
 * Two independent paths, on purpose:
 *
 *  1. Local notifications (always available, no account, no server). The app
 *     polls the customer's own orders while it is running and raises a
 *     notification when a status changes. This is what makes the sound work out
 *     of the box — the channel is created with `res/raw/ersel_chime.wav`.
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
const POLL_INTERVAL_MS = 25_000
const PUSH_ENABLED = String(import.meta.env.VITE_PUSH_ENABLED || '').toLowerCase() === 'true'

export type NotificationSupport = 'native' | 'web' | 'unsupported'

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
      description: 'حالة طلبك: قبول، استلام، في الطريق، تسليم',
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
        body: 'هكذا سيصلك تنبيه عند تغيّر حالة طلبك، بهذا الصوت.',
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
      body: 'هكذا سيصلك تنبيه عند تغيّر حالة طلبك.',
      icon: '/brand/icon-192.png',
      tag: 'ersel-test'
    })
    return { ok: true }
  }

  return { ok: false, error: 'هذا الجهاز لا يدعم الإشعارات.' }
}

/** Stable 31-bit id for a UUID, so the same order reuses the same notification slot. */
function notificationId(orderId: string): number {
  let hash = 0
  for (let i = 0; i < orderId.length; i += 1) {
    hash = (hash * 31 + orderId.charCodeAt(i)) | 0
  }
  return Math.abs(hash) % 2_000_000_000 || 1
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

type NotifiableOrder = Pick<MyOrder, 'id' | 'order_code' | 'pickup' | 'dropoff' | 'price_dzd'>

async function showStatusNotification(order: NotifiableOrder, status: OrderStatus): Promise<void> {
  if (await notificationPermission() !== 'granted') return

  if (isAndroidApp()) {
    await ensureChannel()
    await LocalNotifications.schedule({
      notifications: [{
        id: notificationId(order.id),
        title: orderTitle(order, status),
        body: orderBody(order, status),
        channelId: NOTIFICATION_CHANNEL,
        sound: NOTIFICATION_SOUND,
        smallIcon: 'ic_stat_ersel',
        iconColor: '#0b1f45',
        // Vibrate even in silent mode? No — respect the system profile.
        schedule: { at: new Date(Date.now() + 300) },
        extra: { orderId: order.id, status }
      }]
    })
    return
  }

  if (notificationSupport() === 'web') {
    const notification = new Notification(orderTitle(order, status), {
      body: orderBody(order, status),
      icon: '/brand/icon-192.png',
      tag: `ersel-order-${order.id}`
    })
    notification.onclick = () => {
      window.dispatchEvent(new CustomEvent('ersel:open-order', { detail: { orderId: order.id } }))
      notification.close()
    }
  }
}

/**
 * Watches the signed-in customer's orders and notifies on every status change.
 * The first snapshot only seeds the baseline — no notification storm on login.
 */
export function watchMyOrders(): () => void {
  let stopped = false
  let timer: number | null = null
  let seeded = false
  const seen = new Map<string, OrderStatus>()

  const tick = async () => {
    if (stopped) return
    if (document.visibilityState === 'hidden' && !Capacitor.isNativePlatform()) return

    const result = await loadMyOrders()
    if (!result.ok) return

    for (const order of result.orders) {
      const previous = seen.get(order.id)
      seen.set(order.id, order.status)
      if (!seeded || previous === undefined || previous === order.status) continue
      if (order.status === 'cancelled' && previous === 'cancelled') continue
      await showStatusNotification(order, order.status)
    }
    seeded = true
  }

  void tick()
  timer = window.setInterval(() => { void tick() }, POLL_INTERVAL_MS)

  return () => {
    stopped = true
    if (timer !== null) window.clearInterval(timer)
  }
}

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
export async function registerPush(): Promise<void> {
  if (!PUSH_ENABLED || !Capacitor.isNativePlatform() || !supabase) return

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
          p_app_version: (import.meta.env.VITE_APP_VERSION as string | undefined) || null
        })
        .then(({ error }) => {
          if (error) console.warn('[ERSEL] تعذّر تسجيل رمز الجهاز', error.message)
        })
    })

    await PushNotifications.addListener('registrationError', (error) => {
      console.warn('[ERSEL] فشل تسجيل الإشعارات (تحقّق من google-services.json)', error)
    })

    // A push that arrives while the app is open would otherwise be silent.
    await PushNotifications.addListener('pushNotificationReceived', (notification) => {
      const orderId = String(notification.data?.orderId || '')
      const status = String(notification.data?.status || '') as OrderStatus
      if (!orderId || !STATUS_LABELS[status]) return
      void showStatusNotification(
        {
          id: orderId,
          order_code: String(notification.data?.orderCode || ''),
          pickup: String(notification.data?.pickup || ''),
          dropoff: String(notification.data?.dropoff || ''),
          price_dzd: Number(notification.data?.price || 0)
        },
        status
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
