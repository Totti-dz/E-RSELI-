import { Capacitor } from '@capacitor/core'

export type PlatformInfo = {
  android: boolean
  ios: boolean
  /** يعمل كتطبيق مثبَّت (PWA على الشاشة الرئيسية). */
  standalone: boolean
  /** داخل غلاف APK الأصلي. */
  native: boolean
}

/** iPadOS 13+ يعرّف نفسه كـ Mac، فنتحقق أيضًا من اللمس المتعدد. */
export function detectPlatform(): PlatformInfo {
  if (typeof navigator === 'undefined') return { android: false, ios: false, standalone: false, native: false }
  const ua = navigator.userAgent
  const ios = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const android = /Android/i.test(ua)
  const standalone =
    (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches) ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  let native = false
  try { native = Capacitor.isNativePlatform() } catch { native = false }
  return { android, ios, standalone, native }
}
