/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_TILE_PROVIDER?: string
  readonly VITE_OSM_SEARCH?: string
  readonly VITE_MAP_PROVIDER?: string
  readonly VITE_ROUTING_ENABLED?: string
  /** Direct link to the APK. Overrides the GitHub Releases link. */
  readonly VITE_ANDROID_APK_URL?: string
  /** `owner/repo` — used to build the Releases download link when no direct URL is set. */
  readonly VITE_GITHUB_REPO?: string
  /** `true` enables FCM / Web Push registration (needs Firebase + notify-order). */
  readonly VITE_PUSH_ENABLED?: string
  /** Public VAPID key for Web Push. Private key never belongs in VITE_*. */
  readonly VITE_VAPID_PUBLIC_KEY?: string
  /** Build number injected by CI (GitHub run number). 0 when built locally. */
  readonly VITE_APP_BUILD?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** Injected by vite.config.ts from package.json. */
declare const __APP_VERSION__: string

/** Injected by vite.config.ts from VITE_APP_BUILD (0 for local builds). */
declare const __APP_BUILD__: string
