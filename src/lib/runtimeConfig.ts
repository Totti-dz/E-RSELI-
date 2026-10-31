/**
 * Runtime configuration.
 *
 * Priority: `window.ERSEL_CONFIG` (public/config.js, editable on the host without a
 * rebuild) → build-time `VITE_*` variables. This removes the classic failure where a
 * build made without environment variables silently ships an app that cannot sign up.
 */
export type ErselRuntimeConfig = {
  supabaseUrl?: string
  supabaseAnonKey?: string
  emailDomain?: string
}

declare global {
  interface Window {
    ERSEL_CONFIG?: ErselRuntimeConfig
  }
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readRuntime(): ErselRuntimeConfig {
  if (typeof window === 'undefined') return {}
  return window.ERSEL_CONFIG ?? {}
}

export type ResolvedConfig = {
  url: string
  anonKey: string
  emailDomain: string
  source: 'config.js' | 'build' | 'none'
}

const PLACEHOLDER = /YOUR_PROJECT|YOUR_SUPABASE|xxxx/i

export function resolveConfig(): ResolvedConfig {
  const runtime = readRuntime()
  const rUrl = clean(runtime.supabaseUrl)
  const rKey = clean(runtime.supabaseAnonKey)
  const bUrl = clean(import.meta.env.VITE_SUPABASE_URL)
  const bKey = clean(import.meta.env.VITE_SUPABASE_ANON_KEY)
  const domain = clean(runtime.emailDomain) || 'phone.ersel.app'

  if (rUrl && rKey && !PLACEHOLDER.test(rUrl) && !PLACEHOLDER.test(rKey)) {
    return { url: rUrl.replace(/\/+$/, ''), anonKey: rKey, emailDomain: domain, source: 'config.js' }
  }
  if (bUrl && bKey && !PLACEHOLDER.test(bUrl) && !PLACEHOLDER.test(bKey)) {
    return { url: bUrl.replace(/\/+$/, ''), anonKey: bKey, emailDomain: domain, source: 'build' }
  }
  return { url: '', anonKey: '', emailDomain: domain, source: 'none' }
}

export const config = resolveConfig()
