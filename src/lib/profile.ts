import { supabase } from './supabase'
import { PENDING_SQL, isMissingRpc, isNetworkError, mapServerError } from './rpc'

/**
 * Profile editing for every account (customer, courier, employee).
 *
 * The avatar goes to the public `avatars` bucket under `<user-id>/…`, which is
 * exactly the folder the storage policy allows the owner to write to. Images are
 * downscaled in the browser first: a 4 MB phone photo becomes ~60 KB, which keeps
 * uploads fast on a mobile connection and inside the 2 MB bucket limit.
 */

export const AVATAR_BUCKET = 'avatars'
const AVATAR_MAX_EDGE = 512
const AVATAR_QUALITY = 0.86

const PROFILE_ERRORS: Record<string, string> = {
  not_authenticated: 'سجّل الدخول أولاً.',
  name_invalid: 'الاسم يجب أن يكون بين حرفين و60 حرفًا.',
  avatar_invalid: 'رابط الصورة غير صالح.',
  profile_missing: 'لا يوجد ملف شخصي لهذا الحساب.'
}

export type ProfileUpdate = {
  ok: true
  fullName?: string
  avatarUrl?: string | null
} | { ok: false; error: string }

export async function updateMyProfile(input: {
  fullName?: string
  avatarUrl?: string | null
}): Promise<ProfileUpdate> {
  if (!supabase) return { ok: false, error: 'الخدمة غير متاحة الآن.' }

  const { data, error } = await supabase.rpc('update_my_profile', {
    p_full_name: input.fullName ?? null,
    p_avatar_url: input.avatarUrl === undefined ? null : (input.avatarUrl ?? '')
  })

  if (error) {
    if (isMissingRpc(error.message)) return { ok: false, error: PENDING_SQL }
    if (isNetworkError(error.message)) return { ok: false, error: 'تعذّر الاتصال بالشبكة.' }
    return { ok: false, error: 'تعذّر حفظ الملف الشخصي: ' + error.message }
  }

  const payload = data as { ok?: boolean; error?: string } | null
  if (!payload?.ok) {
    return { ok: false, error: mapServerError(payload?.error, PROFILE_ERRORS, 'تعذّر حفظ الملف الشخصي.') }
  }
  return { ok: true, fullName: input.fullName, avatarUrl: input.avatarUrl }
}

/**
 * Downscale + re-encode to WebP (falls back to JPEG). Returns the original file
 * untouched when the browser cannot decode it, so the upload never silently fails.
 */
export async function shrinkImage(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) return file

  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, AVATAR_MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close?.()

    const blob = await new Promise<Blob | null>(resolve => {
      canvas.toBlob(result => resolve(result), 'image/webp', AVATAR_QUALITY)
    })
    if (blob && blob.size > 0) return blob
    const jpeg = await new Promise<Blob | null>(resolve => {
      canvas.toBlob(result => resolve(result), 'image/jpeg', AVATAR_QUALITY)
    })
    return jpeg && jpeg.size > 0 ? jpeg : file
  } catch {
    return file
  }
}

function extensionFor(blob: Blob): string {
  if (blob.type === 'image/webp') return 'webp'
  if (blob.type === 'image/png') return 'png'
  if (blob.type === 'image/gif') return 'gif'
  return 'jpg'
}

export type AvatarResult =
  | { ok: true; url: string }
  | { ok: false; error: string; kind: 'storage' | 'permission' | 'network' | 'other' }

export async function uploadAvatar(userId: string, file: File): Promise<AvatarResult> {
  if (!supabase) return { ok: false, error: 'الخدمة غير متاحة الآن.', kind: 'other' }

  const blob = await shrinkImage(file)
  const path = `${userId}/avatar-${Date.now()}.${extensionFor(blob)}`

  const { error } = await supabase.storage.from(AVATAR_BUCKET).upload(path, blob, {
    upsert: true,
    cacheControl: '3600',
    contentType: blob.type || 'image/jpeg'
  })

  if (error) {
    const message = error.message || ''
    if (isNetworkError(message)) {
      return { ok: false, error: 'تعذّر الاتصال بالشبكة أثناء رفع الصورة.', kind: 'network' }
    }
    if (/bucket|not found|does not exist/i.test(message)) {
      return {
        ok: false,
        error: 'دلو الصور «avatars» غير موجود. شغّل ملف SQL الموحّد لإنشائه.',
        kind: 'storage'
      }
    }
    if (/row-level security|policy|unauthorized|403/i.test(message)) {
      return {
        ok: false,
        error: 'سياسة التخزين منعت الرفع. تأكّد من تسجيل الدخول ومن صلاحية المجلد.',
        kind: 'permission'
      }
    }
    if (/too large|exceeded/i.test(message)) {
      return { ok: false, error: 'حجم الصورة أكبر من المسموح (2 ميغابايت).', kind: 'storage' }
    }
    return { ok: false, error: 'تعذّر رفع الصورة: ' + message, kind: 'other' }
  }

  const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path)
  if (!data?.publicUrl) {
    return { ok: false, error: 'تم الرفع لكن تعذّر توليد رابط الصورة.', kind: 'other' }
  }
  return { ok: true, url: data.publicUrl }
}

/** Two initials for the avatar placeholder. Handles Arabic and Latin names. */
export function avatarInitials(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '؟'
  if (parts.length === 1) return Array.from(parts[0]).slice(0, 2).join('')
  return Array.from(parts[0])[0] + Array.from(parts[parts.length - 1])[0]
}
