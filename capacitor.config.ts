import type { CapacitorConfig } from '@capacitor/cli'

/**
 * ERSEL — Android shell.
 *
 * The web app in `src/` stays the single source of truth: `npm run build` produces
 * `dist/`, and `npx cap sync android` copies it into the native project. Nothing
 * in the UI is Android-specific except the notification bridge in
 * `src/lib/notifications.ts`, which falls back to a no-op on the web.
 */
const config: CapacitorConfig = {
  appId: 'app.ersel.dz',
  appName: 'ERSEL',
  webDir: 'dist',
  android: {
    // The whole app is served from the bundled assets, so cleartext traffic is
    // never needed. Keep it off: it also blocks accidental http:// calls.
    allowMixedContent: false,
    backgroundColor: '#0b1f45'
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 900,
      launchAutoHide: true,
      backgroundColor: '#0b1f45',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: false,
      splashImmersive: false
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_ersel',
      iconColor: '#0b1f45',
      // Must match a file in android/app/src/main/res/raw/ (no extension here).
      sound: 'ersel_chime'
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert']
    }
  }
}

export default config
