import { supabase } from './supabase'

export type AppRole = 'customer' | 'courier' | 'employee' | 'admin'

export type Profile = {
  id: string
  full_name: string
  phone: string
  role: AppRole
}

const SYNTH_DOMAIN = 'phone.ersel.app'

const AR_DIGITS: Record<string, string> = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
  '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9'
}

export function normalizePhone(raw: string): { ok: true; e164: string } | { ok: false; error: string } {
  if (!raw || !raw.trim()) return { ok: false, error: 'يرجى إدخال رقم الهاتف.' }
  let s = Array.from(raw).map(ch => AR_DIGITS[ch] ?? ch).join('')
  s = s.replace(/[^\d+]/g, '')
  if (s.startsWith('+')) s = s.slice(1)
  if (s.startsWith('00')) s = s.slice(2)
  if (s.startsWith('213')) s = s.slice(3)
  s = s.replace(/^0+/, '')
  if (!/^[5-7]\d{8}$/.test(s)) {
    return { ok: false, error: 'رقم الهاتف غير صحيح. استعمل رقماً جزائرياً مثل 0551234567.' }
  }
  return { ok: true, e164: '+213' + s }
}

export function phoneToEmail(e164: string): string {
  return `${e164.replace(/\D/g, '')}@${SYNTH_DOMAIN}`
}

export function passwordProblem(password: string): string | null {
  if (password.length < 8) return 'كلمة المرور يجب أن تكون 8 أحرف على الأقل.'
  if (!/[A-Za-z\u0600-\u06FF]/.test(password)) return 'أضف حرفاً واحداً على الأقل إلى كلمة المرور.'
  if (!/\d/.test(password)) return 'أضف رقماً واحداً على الأقل إلى كلمة المرور.'
  return null
}

export function mapAuthError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('database error saving new user')) return 'تعذّر إنشاء الحساب. ربما رقم الهاتف مستعمل مسبقاً.'
  if (m.includes('email signups are disabled') || m.includes('signups are disabled')) return 'إنشاء الحسابات معطّل في إعدادات الخدمة. فعّل مزوّد Email في Supabase (Authentication → Sign In / Providers).'
  if (m.includes('email logins are disabled')) return 'تسجيل الدخول معطّل في إعدادات الخدمة. فعّل مزوّد Email في Supabase.'
  if (m.includes('invalid login credentials')) return 'رقم الهاتف أو كلمة المرور غير صحيحة.'
  if (m.includes('user already registered')) return 'يوجد حساب مسجّل بهذا الرقم. جرّب تسجيل الدخول.'
  if (m.includes('rate limit') || m.includes('security purposes')) return 'محاولات كثيرة. انتظر قليلاً ثم أعد المحاولة.'
  if (m.includes('email not confirmed')) return 'الحساب يحتاج تأكيداً. تواصل مع الدعم.'
  if (m.includes('network') || m.includes('failed to fetch')) return 'تعذّر الاتصال بالشبكة. تحقّق من الإنترنت وأعد المحاولة.'
  if (m.includes('password should be')) return 'كلمة المرور ضعيفة. استعمل 8 أحرف على الأقل.'
  return 'تعذّر إتمام العملية. حاول مرة أخرى.'
}

type Result = { ok: true } | { ok: false; error: string }

export async function signUpCustomer(input: {
  fullName: string
  phone: string
  password: string
}): Promise<Result> {
  if (!supabase) return { ok: false, error: 'الخدمة غير متاحة الآن. تواصل مع فريق ERSEL' }
  const phone = normalizePhone(input.phone)
  if (!phone.ok) return { ok: false, error: phone.error }
  const name = input.fullName.trim()
  if (name.length < 2) return { ok: false, error: 'يرجى إدخال الاسم الكامل.' }

  const { data, error } = await supabase.auth.signUp({
    email: phoneToEmail(phone.e164),
    password: input.password,
    options: { data: { full_name: name, phone: phone.e164 } }
  })
  if (error) return { ok: false, error: mapAuthError(error.message) }
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    return { ok: false, error: 'يوجد حساب مسجّل بهذا الرقم. جرّب تسجيل الدخول.' }
  }
  if (!data.session) {
    return { ok: false, error: 'تم إنشاء الحساب لكن الدخول التلقائي غير مفعّل. جرّب تسجيل الدخول.' }
  }
  return { ok: true }
}

export type SignInResult =
  | { ok: true; role: AppRole }
  | { ok: true; role: null; profileMissing: true }
  | { ok: false; error: string }

export async function signInWithIdentifier(input: {
  identifier: string
  password: string
}): Promise<SignInResult> {
  if (!supabase) return { ok: false, error: 'الخدمة غير متاحة الآن. تواصل مع فريق ERSEL' }

  const raw = (input.identifier || '').trim()
  let email: string
  if (raw.includes('@')) {
    email = raw.toLowerCase()
  } else {
    const phone = normalizePhone(raw)
    if (!phone.ok) return { ok: false, error: phone.error }
    email = phoneToEmail(phone.e164)
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: input.password
  })
  if (error) return { ok: false, error: mapAuthError(error.message) }

  const userId = data.user?.id
  if (!userId) return { ok: false, error: 'تعذّر قراءة بيانات الحساب.' }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle()
  if (profileError) return { ok: false, error: 'تم الدخول لكن تعذّر تحميل الملف الشخصي. أعد المحاولة دون تسجيل الخروج.' }
  if (!profile) return { ok: true, role: null, profileMissing: true }

  const role = profile.role as AppRole | undefined
  if (role !== 'customer' && role !== 'courier' && role !== 'employee' && role !== 'admin') {
    return { ok: false, error: 'دور الحساب غير معروف. تواصل مع الإدارة.' }
  }
  return { ok: true, role }
}

export async function signOutEverywhere(): Promise<void> {
  if (!supabase) return
  await supabase.auth.signOut()
}

export type AdminAccessResult =
  | { ok: true; profile: Profile }
  | { ok: false; reason: 'no_client' | 'no_session' | 'profile_missing' | 'profile_forbidden' | 'profile_error' | 'not_admin'; error: string }

export async function verifyAdminAccess(): Promise<AdminAccessResult> {
  if (!supabase) {
    return { ok: false, reason: 'no_client', error: 'الاتصال بقاعدة البيانات غير مُعد. لا يمكن التحقق من صلاحية الإدارة.' }
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
  if (sessionError) {
    return { ok: false, reason: 'profile_error', error: 'تعذّر التحقق من الجلسة. أعد المحاولة.' }
  }
  const userId = sessionData.session?.user?.id
  if (!userId) {
    return { ok: false, reason: 'no_session', error: 'لا توجد جلسة صالحة. سجّل الدخول أولًا بحساب المدير المعتمد.' }
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, phone, role')
    .eq('id', userId)
    .maybeSingle()

  if (error) {
    const message = error.message || ''
    if (error.code === '42501' || /permission|row-level security|policy/i.test(message)) {
      return {
        ok: false,
        reason: 'profile_forbidden',
        error: 'تعذّر قراءة صلاحية الحساب بسبب سياسة الوصول. الرمز لا يتجاوز ذلك.'
      }
    }
    if (/failed to fetch|network/i.test(message)) {
      return { ok: false, reason: 'profile_error', error: 'تعذّر الاتصال بالشبكة أثناء التحقق من الصلاحية.' }
    }
    return { ok: false, reason: 'profile_error', error: 'تعذّر قراءة الملف الشخصي من قاعدة البيانات.' }
  }

  if (!data) {
    return {
      ok: false,
      reason: 'profile_missing',
      error: 'الحساب مسجّل لكن لا يوجد ملف شخصي في قاعدة البيانات. تواصل مع الإدارة.'
    }
  }

  const role = data.role as AppRole | undefined
  if (role !== 'admin') {
    return {
      ok: false,
      reason: 'not_admin',
      error: 'هذا الحساب لا يملك دور المدير في قاعدة البيانات. الرمز لا يمنح الدور.'
    }
  }

  return {
    ok: true,
    profile: {
      id: data.id as string,
      full_name: (data.full_name as string) || '',
      phone: (data.phone as string) || '',
      role: 'admin'
    }
  }
}

const ADMIN_UNLOCK_ERRORS: Record<string, string> = {
  not_authenticated: 'سجّل الدخول بحسابك أولاً ثم أدخل رمز الإدارة.',
  not_admin: 'هذا الحساب ليس مديرًا في قاعدة البيانات. الرمز لا يمنح الدور — الترقية تتم من الخادم فقط.',
  invalid_code: 'رمز الإدارة غير صحيح.',
  locked: 'محاولات كثيرة خاطئة. انتظر 15 دقيقة ثم أعد المحاولة.'
}

/** The code is checked on the server only; it never exists in browser code. */
export async function unlockAdminWithCode(code: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!supabase) return { ok: false, error: 'الخدمة غير متاحة الآن. تواصل مع فريق ERSEL' }
  const { data, error } = await supabase.rpc('admin_unlock', { p_code: code })
  if (error) {
    if (/does not exist|schema cache/i.test(error.message)) {
      return { ok: false, error: 'دخول الإدارة غير مفعّل على الخادم. شغّل ملف supabase/ersel_v2.sql.' }
    }
    return { ok: false, error: 'تعذّر التحقق من الرمز. أعد المحاولة.' }
  }
  const result = data as { ok?: boolean; error?: string } | null
  if (!result?.ok) return { ok: false, error: ADMIN_UNLOCK_ERRORS[result?.error || ''] || 'تعذّر التحقق من الرمز.' }
  return { ok: true }
}

const RESET_ERRORS: Record<string, string> = {
  phone_invalid: 'رقم الهاتف غير صحيح. استعمل رقماً جزائرياً مثل 0551234567.',
  password_weak: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل وتحتوي حرفاً ورقماً.',
  rate_limited: 'محاولات كثيرة لهذا الرقم. حاول بعد ساعة.',
  account_not_found: 'لا يوجد حساب بهذا الرقم.',
  not_authenticated: 'استعادة كلمة المرور من شاشة الدخول معطّلة لحماية الحسابات. سجّل الدخول ثم غيّر كلمة المرور من حسابك.',
  not_owner: 'يمكنك تغيير كلمة مرور حسابك فقط. للاستعادة تواصل مع الإدارة.',
  staff_not_allowed: 'حسابات الموظفين والإدارة لا تُستعاد من هنا. تواصل مع الإدارة.'
}

export async function resetPasswordByPhone(input: { phone: string; password: string }): Promise<Result> {
  if (!supabase) return { ok: false, error: 'الخدمة غير متاحة الآن. تواصل مع فريق ERSEL' }
  const phone = normalizePhone(input.phone)
  if (!phone.ok) return { ok: false, error: phone.error }
  const problem = passwordProblem(input.password)
  if (problem) return { ok: false, error: problem }
  const { data, error } = await supabase.rpc('reset_password_by_phone', { p_phone: phone.e164, p_new_password: input.password })
  if (error) {
    if (/does not exist|schema cache/i.test(error.message)) {
      return { ok: false, error: 'استعادة كلمة المرور غير مفعّلة على الخادم. شغّل ملف supabase/ersel_v2.sql.' }
    }
    if (error.code === '42501' || /permission denied|not authorized/i.test(error.message)) {
      return { ok: false, error: RESET_ERRORS.not_authenticated }
    }
    return { ok: false, error: 'تعذّر تغيير كلمة المرور. أعد المحاولة.' }
  }
  const result = data as { ok?: boolean; error?: string } | null
  if (!result?.ok) return { ok: false, error: RESET_ERRORS[result?.error || ''] || 'تعذّر تغيير كلمة المرور.' }
  return { ok: true }
}
