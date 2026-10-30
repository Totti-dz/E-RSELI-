import { supabase } from './supabase'
import { normalizePhone } from './auth'

export type VehicleKind = 'motorcycle' | 'car'

export type ApplicationStatus = 'pending' | 'approved' | 'rejected'

export type CourierApplication = {
  firstName: string
  lastName: string
  phone: string
  ageYears: number
  vehicle: VehicleKind
  vehicleMake: string
  vehicleModel: string
  vehiclePlate: string
  city: string
  status: ApplicationStatus
  rejectionReason: string
  createdAt: string
  reviewedAt: string | null
}

export type AdminCourierApplication = CourierApplication & {
  userId: string
}

export type CourierDraft = {
  firstName: string
  lastName: string
  phone: string
  ageYears: number
  vehicle: VehicleKind
  vehicleMake: string
  vehicleModel: string
  vehiclePlate: string
  city: string
}

export type ApplyResult =
  | { ok: true; status: ApplicationStatus }
  | { ok: false; error: string; kind: 'auth' | 'validation' | 'pending_sql' | 'permission' | 'network' | 'other' }

export type LoadResult =
  | { ok: true; application: CourierApplication | null; verified: boolean; schemaReady: boolean }
  | { ok: false; error: string; kind: 'pending_sql' | 'auth' | 'network' | 'other' }

const APPLY_ERRORS: Record<string, string> = {
  not_authenticated: 'سجّل الدخول أولاً لإرسال طلب الانضمام.',
  not_customer: 'طلب الانضمام متاح لحساب الزبون فقط.',
  already_staff: 'هذا الحساب موظف أو موصّل معتمد بالفعل.',
  already_pending: 'لديك طلب قيد المراجعة. انتظر قرار الإدارة.',
  already_approved: 'تم اعتماد حسابك مسبقاً.',
  first_name_invalid: 'أدخل الاسم بشكل صحيح (حرفان على الأقل).',
  last_name_invalid: 'أدخل اللقب بشكل صحيح (حرفان على الأقل).',
  phone_required: 'يرجى إدخال رقم الهاتف.',
  phone_invalid: 'رقم الهاتف غير صحيح. استعمل رقماً جزائرياً مثل 0551234567.',
  age_invalid: 'يجب أن يكون عمرك 18 سنة على الأقل.',
  vehicle_invalid: 'اختر وسيلة النقل.',
  vehicle_plate_required: 'أدخل رقم لوحة المركبة.',
  city_invalid: 'منطقة الخدمة غير صالحة.',
  permission_denied: 'الصلاحيات لا تسمح بهذا الإجراء.',
  application_not_found: 'طلب الانضمام غير موجود.',
  already_reviewed: 'هذا الطلب سبقت مراجعته.'
}

type ApplyErrorKind = Extract<ApplyResult, { ok: false }>['kind']

function mapError(message: string, fallback: string): { error: string; kind: ApplyErrorKind } {
  const key = (message || '').trim()
  if (APPLY_ERRORS[key]) return { error: APPLY_ERRORS[key], kind: key === 'not_authenticated' ? 'auth' : 'other' }
  if (/schema cache|does not exist|PGRST202|PGRST205/i.test(message)) {
    return {
      error: 'حفظ طلب الانضمام غير مفعّل على الخادم بعد. لم يُحفظ أي طلب ولم يُغيَّر دور الحساب.',
      kind: 'pending_sql'
    }
  }
  if (/row-level security|42501|permission/i.test(message)) {
    return { error: 'سياسة الوصول منعت الحفظ. لم نتجاوز الأمان من الواجهة.', kind: 'permission' }
  }
  if (/failed to fetch|network/i.test(message)) {
    return { error: 'تعذّر الاتصال بالشبكة.', kind: 'network' }
  }
  return { error: fallback + message, kind: 'other' }
}

export function validateCourierDraft(draft: CourierDraft): string | null {
  const first = draft.firstName.trim()
  const last = draft.lastName.trim()
  if (first.length < 2) return APPLY_ERRORS.first_name_invalid
  if (last.length < 2) return APPLY_ERRORS.last_name_invalid
  const phone = normalizePhone(draft.phone)
  if (!phone.ok) return phone.error
  if (!Number.isInteger(draft.ageYears) || draft.ageYears < 18 || draft.ageYears > 80) {
    return APPLY_ERRORS.age_invalid
  }
  if (draft.vehicle !== 'motorcycle' && draft.vehicle !== 'car') return APPLY_ERRORS.vehicle_invalid
  if (draft.vehicle === 'car' && draft.vehiclePlate.trim().length < 3) return APPLY_ERRORS.vehicle_plate_required
  if (draft.city.trim().length < 2) return APPLY_ERRORS.city_invalid
  return null
}

function asStatus(value: unknown): ApplicationStatus | null {
  return value === 'pending' || value === 'approved' || value === 'rejected' ? value : null
}

function asApplication(row: Record<string, unknown>): CourierApplication | null {
  const status = asStatus(row.status)
  if (!status) return null
  return {
    firstName: String(row.first_name || ''),
    lastName: String(row.last_name || ''),
    phone: String(row.phone || ''),
    ageYears: Number(row.age_years || 0),
    vehicle: row.vehicle === 'car' ? 'car' : 'motorcycle',
    vehicleMake: String(row.vehicle_make || ''),
    vehicleModel: String(row.vehicle_model || ''),
    vehiclePlate: String(row.vehicle_plate || ''),
    city: String(row.city || ''),
    status,
    rejectionReason: String(row.rejection_reason || ''),
    createdAt: String(row.created_at || ''),
    reviewedAt: row.reviewed_at ? String(row.reviewed_at) : null
  }
}

export async function loadCourierApplication(): Promise<LoadResult> {
  if (!supabase) return { ok: false, error: 'الاتصال بقاعدة البيانات غير مُعد.', kind: 'other' }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
  if (sessionError) return { ok: false, error: 'تعذّر التحقق من الجلسة.', kind: 'network' }
  const userId = sessionData.session?.user?.id
  if (!userId) return { ok: false, error: APPLY_ERRORS.not_authenticated, kind: 'auth' }

  const { data: profileRow } = await supabase
    .from('courier_profiles')
    .select('is_verified')
    .eq('user_id', userId)
    .maybeSingle()
  const verified = Boolean(profileRow && (profileRow as { is_verified?: boolean }).is_verified)

  const { data, error } = await supabase
    .from('courier_applications')
    .select('first_name,last_name,phone,age_years,vehicle,vehicle_make,vehicle_model,vehicle_plate,city,status,rejection_reason,created_at,reviewed_at')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    const mapped = mapError(error.message, 'تعذّر قراءة طلب الانضمام: ')
    if (mapped.kind === 'pending_sql') {
      return { ok: true, application: null, verified, schemaReady: false }
    }
    return { ok: false, error: mapped.error, kind: mapped.kind === 'network' ? 'network' : mapped.kind === 'auth' ? 'auth' : 'other' }
  }

  return {
    ok: true,
    application: data ? asApplication(data as Record<string, unknown>) : null,
    verified,
    schemaReady: true
  }
}

export async function submitCourierApplication(draft: CourierDraft): Promise<ApplyResult> {
  if (!supabase) return { ok: false, error: 'الاتصال بقاعدة البيانات غير مُعد.', kind: 'other' }

  const problem = validateCourierDraft(draft)
  if (problem) return { ok: false, error: problem, kind: 'validation' }

  const phone = normalizePhone(draft.phone)
  if (!phone.ok) return { ok: false, error: phone.error, kind: 'validation' }

  const { data: sessionData } = await supabase.auth.getSession()
  if (!sessionData.session?.user?.id) {
    return { ok: false, error: APPLY_ERRORS.not_authenticated, kind: 'auth' }
  }

  const { data, error } = await supabase.rpc('submit_courier_application', {
    payload: {
      first_name: draft.firstName.trim(),
      last_name: draft.lastName.trim(),
      phone: phone.e164,
      age_years: draft.ageYears,
      vehicle: draft.vehicle,
      vehicle_make: draft.vehicleMake.trim(),
      vehicle_model: draft.vehicleModel.trim(),
      vehicle_plate: draft.vehiclePlate.trim(),
      city: draft.city.trim()
    }
  })

  if (error) {
    const mapped = mapError(error.message, 'تعذّر إرسال الطلب: ')
    return { ok: false, error: mapped.error, kind: mapped.kind }
  }

  const result = data as { ok?: boolean; status?: string; error?: string } | null
  if (!result?.ok) {
    const mapped = mapError(result?.error || 'unknown', 'تعذّر إرسال الطلب: ')
    return { ok: false, error: mapped.error, kind: mapped.kind }
  }

  const status = asStatus(result.status)
  if (!status) return { ok: false, error: 'أُرسل الطلب لكن الحالة المعادة غير معروفة.', kind: 'other' }
  return { ok: true, status }
}

export async function loadCourierVerification(userId: string): Promise<{ verified: boolean; found: boolean }> {
  if (!supabase) return { verified: false, found: false }
  const { data, error } = await supabase
    .from('courier_profiles')
    .select('is_verified')
    .eq('user_id', userId)
    .maybeSingle()
  if (error || !data) return { verified: false, found: false }
  return { verified: Boolean((data as { is_verified?: boolean }).is_verified), found: true }
}

export type AdminApplicationsResult =
  | { ok: true; applications: AdminCourierApplication[] }
  | { ok: false; error: string; kind: 'permission' | 'network' | 'other' }

function asAdminApplication(row: Record<string, unknown>): AdminCourierApplication | null {
  const base = asApplication(row)
  const userId = String(row.user_id || '')
  if (!base || !userId) return null
  return { ...base, userId }
}

export async function loadAdminApplications(): Promise<AdminApplicationsResult> {
  if (!supabase) return { ok: false, error: 'الاتصال بقاعدة البيانات غير مُعد.', kind: 'other' }
  const { data, error } = await supabase
    .from('courier_applications')
    .select('user_id,first_name,last_name,phone,age_years,vehicle,vehicle_make,vehicle_model,vehicle_plate,city,status,rejection_reason,created_at,reviewed_at')
    .order('created_at', { ascending: false })
    .limit(80)
  if (error) {
    const mapped = mapError(error.message, 'تعذّر تحميل طلبات الانضمام: ')
    if (mapped.kind === 'permission' || mapped.kind === 'pending_sql') {
      return {
        ok: false,
        kind: 'permission',
        error: 'صلاحيات قاعدة البيانات لا تسمح بقراءة طلبات الانضمام لهذا الحساب.'
      }
    }
    if (mapped.kind === 'network') return { ok: false, kind: 'network', error: mapped.error }
    return { ok: false, kind: 'other', error: mapped.error }
  }
  const rows = (data ?? []) as unknown as Record<string, unknown>[]
  return {
    ok: true,
    applications: rows.map(asAdminApplication).filter((row): row is AdminCourierApplication => !!row)
  }
}

export type ReviewDecision = Exclude<ApplicationStatus, 'pending'>

export async function reviewCourierApplication(
  userId: string,
  decision: ReviewDecision,
  reason = ''
): Promise<ApplyResult> {
  if (!supabase) return { ok: false, error: 'الاتصال بقاعدة البيانات غير مُعد.', kind: 'other' }
  const { data, error } = await supabase.rpc('review_courier_application', {
    p_user_id: userId,
    p_decision: decision,
    p_reason: reason
  })
  if (error) {
    const mapped = mapError(error.message, 'تعذّر مراجعة الطلب: ')
    return { ok: false, error: mapped.error, kind: mapped.kind }
  }
  const result = data as { ok?: boolean; status?: string; error?: string } | null
  if (!result?.ok) {
    const mapped = mapError(result?.error || 'unknown', 'تعذّر مراجعة الطلب: ')
    return { ok: false, error: mapped.error, kind: mapped.kind }
  }
  const status = asStatus(result.status)
  if (status !== 'approved' && status !== 'rejected') {
    return { ok: false, error: 'أُرسل القرار لكن الحالة المعادة غير معروفة.', kind: 'other' }
  }
  return { ok: true, status }
}
