import { useCallback, useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import type { AppRole, Profile } from '../lib/auth'

type Status = 'loading' | 'ready' | 'error'
type ProfileStatus = 'idle' | 'loading' | 'ready' | 'missing' | 'error'

const ROLE_VALUES: AppRole[] = ['customer', 'courier', 'employee', 'admin']

function asRole(value: unknown): AppRole | null {
  return ROLE_VALUES.includes(value as AppRole) ? (value as AppRole) : null
}

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [status, setStatus] = useState<Status>('loading')
  const [profileStatus, setProfileStatus] = useState<ProfileStatus>('idle')
  const [error, setError] = useState('')
  const [profileError, setProfileError] = useState('')
  const mounted = useRef(true)
  const requestId = useRef(0)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const loadProfile = useCallback(async (userId: string, attempt = 0): Promise<Profile | null> => {
    if (!supabase) return null
    let { data, error: queryError } = await supabase
      .from('profiles')
      .select('id, full_name, phone, role, avatar_url')
      .eq('id', userId)
      .maybeSingle()

    // Deployments that have not run migration 14 yet have no avatar_url column.
    if (queryError && /avatar_url|42703|column .* does not exist/i.test(queryError.message || '')) {
      const fallback = await supabase
        .from('profiles')
        .select('id, full_name, phone, role')
        .eq('id', userId)
        .maybeSingle()
      data = fallback.data as typeof data
      queryError = fallback.error
    }

    if (queryError) throw queryError
    if (!data && attempt < 4) {
      await new Promise(resolve => setTimeout(resolve, 350 * (attempt + 1)))
      return loadProfile(userId, attempt + 1)
    }
    if (!data) return null
    const role = asRole(data.role)
    if (!role) {
      throw new Error('تعذّر قراءة دور الحساب من قاعدة البيانات.')
    }
    const row = data as Record<string, unknown>
    return {
      id: row.id as string,
      full_name: (row.full_name as string) || '',
      phone: (row.phone as string) || '',
      role,
      avatar_url: row.avatar_url ? String(row.avatar_url) : null
    }
  }, [])

  const applySession = useCallback(async (next: Session | null) => {
    const id = ++requestId.current
    if (!mounted.current) return
    setSession(next)
    if (!next?.user) {
      setProfile(null)
      setProfileStatus('idle')
      setProfileError('')
      return
    }
    setProfileStatus('loading')
    setProfileError('')
    try {
      const loaded = await loadProfile(next.user.id)
      if (!mounted.current || id !== requestId.current) return
      if (!loaded) {
        setProfile(null)
        setProfileStatus('missing')
        setProfileError('الحساب موجود لكن الملف الشخصي غير محفوظ بعد. أعد المحاولة أو تواصل مع الإدارة.')
        return
      }
      setProfile(loaded)
      setProfileStatus('ready')
    } catch (e) {
      if (!mounted.current || id !== requestId.current) return
      setProfile(null)
      setProfileStatus('error')
      setProfileError(e instanceof Error ? e.message : 'تعذّر تحميل الملف الشخصي.')
    }
  }, [loadProfile])

  const bootstrap = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) {
      setSession(null)
      setProfile(null)
      setProfileStatus('idle')
      setProfileError('')
      setError('')
      setStatus('ready')
      return
    }
    setStatus('loading')
    setError('')
    try {
      const { data, error: sessionError } = await supabase.auth.getSession()
      if (sessionError) throw sessionError
      await applySession(data.session)
      if (!mounted.current) return
      setStatus('ready')
    } catch (e) {
      if (!mounted.current) return
      setStatus('error')
      setError(e instanceof Error ? e.message : 'تعذّر التحقق من الجلسة.')
    }
  }, [applySession])

  useEffect(() => { void bootstrap() }, [bootstrap])

  useEffect(() => {
    if (!supabase) return
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      void applySession(nextSession).then(() => {
        if (mounted.current) setStatus('ready')
      })
    })
    return () => { data.subscription.unsubscribe() }
  }, [applySession])

  const signOut = useCallback(async () => {
    if (!supabase) return
    await supabase.auth.signOut()
    setSession(null)
    setProfile(null)
    setProfileStatus('idle')
    setProfileError('')
  }, [])

  const retryProfile = useCallback(async () => {
    if (session?.user) await applySession(session)
  }, [applySession, session])

  const applyVerifiedProfile = useCallback((next: Profile) => {
    setProfile(next)
    setProfileStatus('ready')
    setProfileError('')
  }, [])

  return {
    session,
    profile,
    status,
    profileStatus,
    error,
    profileError,
    retry: bootstrap,
    retryProfile,
    applyVerifiedProfile,
    signOut
  }
}
