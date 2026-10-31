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

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __APP_BUILD__: JSON.stringify(appBuild)
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
