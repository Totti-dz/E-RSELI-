import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

async function load() {
  vi.resetModules()
  return import('../runtimeConfig')
}

describe('runtime config (config.js)', () => {
  beforeEach(() => { vi.unstubAllGlobals() })
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

  it('reads supabase url/key from window.ERSEL_CONFIG', async () => {
    vi.stubGlobal('window', { ERSEL_CONFIG: { supabaseUrl: 'https://abc.supabase.co/', supabaseAnonKey: 'key123' } })
    const { resolveConfig } = await load()
    expect(resolveConfig()).toMatchObject({ url: 'https://abc.supabase.co', anonKey: 'key123', source: 'config.js', emailDomain: 'phone.ersel.app' })
  })

  it('ignores placeholder values and reports not configured', async () => {
    vi.stubGlobal('window', { ERSEL_CONFIG: { supabaseUrl: 'https://YOUR_PROJECT.supabase.co', supabaseAnonKey: 'YOUR_SUPABASE_ANON_KEY' } })
    const { resolveConfig } = await load()
    expect(resolveConfig().source).toBe('none')
  })

  it('falls back to build-time variables when config.js is absent', async () => {
    vi.stubGlobal('window', {})
    vi.stubEnv('VITE_SUPABASE_URL', 'https://built.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'builtkey')
    const { resolveConfig } = await load()
    expect(resolveConfig()).toMatchObject({ url: 'https://built.supabase.co', source: 'build' })
  })

  it('config.js wins over build variables and the email domain is configurable', async () => {
    vi.stubGlobal('window', { ERSEL_CONFIG: { supabaseUrl: 'https://rt.supabase.co', supabaseAnonKey: 'rt', emailDomain: 'ersel.example' } })
    vi.stubEnv('VITE_SUPABASE_URL', 'https://built.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'builtkey')
    const { resolveConfig } = await load()
    const c = resolveConfig()
    expect(c.url).toBe('https://rt.supabase.co')
    expect(c.emailDomain).toBe('ersel.example')
  })
})

describe('auth error messages', () => {
  it('turns the real Supabase causes into actionable Arabic instructions', async () => {
    const { mapAuthError } = await import('../auth')
    expect(mapAuthError('Email address is not authorized', 'email_address_not_authorized')).toMatch(/Confirm email/)
    expect(mapAuthError('Email rate limit exceeded', 'over_email_send_rate_limit')).toMatch(/Confirm email/)
    expect(mapAuthError('Signups not allowed for this instance', 'signup_disabled')).toMatch(/Allow new users/)
    expect(mapAuthError('Database error saving new user')).toMatch(/check\.html/)
    expect(mapAuthError('Invalid login credentials')).toMatch(/غير صحيحة/)
    expect(mapAuthError('something unknown')).toMatch(/check\.html/)
  })
})
