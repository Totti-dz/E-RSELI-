import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

// Single source of truth for the version: package.json feeds the web bundle, the
// APK (android/app/build.gradle) and the GitHub release tag.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version?: string }
const appVersion = process.env.npm_package_version || pkg.version || '0.1.0'

// Monotonic build number, injected by CI as the GitHub run number. It lets the
// installed app tell whether a newer APK exists — without it (local or hosted
// build) the value stays 0 and the update check is skipped.
const appBuild = (process.env.VITE_APP_BUILD || '0').trim()

// Safety net: public/config.js is also embedded in the bundle as a last-resort
// fallback, so an app whose config.js failed to load (host challenge page, stale
// cache, wrong upload) still talks to Supabase instead of "service unavailable".
function fallbackFromConfigJs(): { url: string; key: string } {
  if (process.env.VITEST) return { url: '', key: '' }
  try {
    const text = readFileSync(new URL('./public/config.js', import.meta.url), 'utf8')
    const url = /supabaseUrl\s*:\s*"([^"]+)"/.exec(text)?.[1] ?? ''
    const key = /supabaseAnonKey\s*:\s*"([^"]+)"/.exec(text)?.[1] ?? ''
    return { url, key }
  } catch {
    return { url: '', key: '' }
  }
}
const fallback = fallbackFromConfigJs()

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __APP_BUILD__: JSON.stringify(appBuild),
    __FALLBACK_SUPABASE_URL__: JSON.stringify(fallback.url),
    __FALLBACK_SUPABASE_KEY__: JSON.stringify(fallback.key)
  },
  server: {
    host: '0.0.0.0',
    allowedHosts: ['.monkeycode-ai.live']
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: ['.monkeycode-ai.live']
  }
})
