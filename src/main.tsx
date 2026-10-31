import React from 'react'
import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import App from './App'
import { isSupabaseConfigured } from './lib/supabase'
import './styles.css'

// The public UI never shows configuration notices: a missing database is an
// operator problem, not something a visitor should read on the home page.
// The console keeps the signal for whoever deploys the app.
if (!isSupabaseConfigured) {
  console.warn(
    '[ERSEL] Supabase غير مُعد: عدّل supabaseUrl و supabaseAnonKey في ملف config.js (بجانب index.html) ثم حدّث الصفحة. ' +
    'حتى ذلك الحين تعمل الواجهة للعرض فقط، ولن يُحفظ أي حساب أو طلب.'
  )
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>
)

// The Android build serves the app from bundled assets, so a service worker
// would only add a stale-cache layer between the user and the shipped bundle.
if ('serviceWorker' in navigator && import.meta.env.PROD && !Capacitor.isNativePlatform()) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(console.error))
}

// Dark status-bar icons: the app background is light, the splash is navy.
if (Capacitor.isNativePlatform()) {
  void import('@capacitor/status-bar')
    .then(({ StatusBar, Style }) => StatusBar.setStyle({ style: Style.Dark }))
    .catch(() => { /* older Android versions ignore this */ })
}
