import { supabase } from './supabase'

export type CourierStatus = {
  verified: boolean
  available: boolean
  vehicle: 'motorcycle' | 'car' | null
  city: string | null
}

export type CourierStatusResult =
  | { ok: true; status: CourierStatus }
  | { ok: false; error: string }

/**
 * The courier's own row in courier_profiles.
 * RLS ("courier profile read self or admin") limits this to the signed-in user,
 * and the update trigger only protects is_verified / storage paths — so
 * is_available is safe to toggle from the client.
 */
export async function loadCourierStatus(userId: string): Promise<CourierStatusResult> {
  if (!supabase) return { ok: false, error: 'الاتصال بقاعدة البيانات غير مُعد.' }

  const { data, error } = await supabase
    .from('courier_profiles')
    .select('vehicle,city,is_verified,is_available')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    if (/failed to fetch|network/i.test(error.message)) {
      return { ok: false, error: 'تعذّر الاتصال بالشبكة.' }
    }
    return { ok: false, error: 'تعذّر قراءة حالة الموصّل: ' + error.message }
  }
  if (!data) return { ok: false, error: 'لا يوجد ملف موصّل لهذا الحساب بعد.' }

  const row = data as Record<string, unknown>
  return {
    ok: true,
    status: {
      verified: row.is_verified === true,
      available: row.is_available === true,
      vehicle: row.vehicle === 'car' ? 'car' : row.vehicle === 'motorcycle' ? 'motorcycle' : null,
      city: typeof row.city === 'string' ? row.city : null
    }
  }
}

export async function setCourierAvailability(
  userId: string,
  available: boolean
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!supabase) return { ok: false, error: 'الاتصال بقاعدة البيانات غير مُعد.' }

  const { error } = await supabase
    .from('courier_profiles')
    .update({ is_available: available })
    .eq('user_id', userId)

  if (error) {
    if (error.code === '42501' || /permission|policy/i.test(error.message)) {
      return { ok: false, error: 'الصلاحيات لا تسمح بتغيير حالة العمل.' }
    }
    if (/failed to fetch|network/i.test(error.message)) {
      return { ok: false, error: 'تعذّر الاتصال بالشبكة.' }
    }
    return { ok: false, error: 'تعذّر تحديث حالة العمل: ' + error.message }
  }
  return { ok: true }
}
