/** Shared helpers for Supabase RPC error handling. */

export const PENDING_SQL =
  'هذه الميزة غير مفعّلة على الخادم بعد. شغّل ملف SQL الموحّد (supabase/ersel_all_in_one.sql).'

/** PostgREST says "schema cache" / PGRST202 when the function or table is absent. */
export function isMissingRpc(message: string): boolean {
  return /schema cache|does not exist|PGRST202|PGRST205|Could not find the function/i.test(message || '')
}

export function isMissingColumn(message: string): boolean {
  return /column .* does not exist|42703/i.test(message || '')
}

export function isNetworkError(message: string): boolean {
  return /failed to fetch|networkerror|load failed|network request failed/i.test(message || '')
}

export function isPermissionError(message: string, code?: string): boolean {
  return code === '42501' || /permission|row-level security|policy/i.test(message || '')
}

/** Server functions return `{ ok: false, error: 'key' }`; map the key to Arabic. */
export function mapServerError(
  raw: string | undefined,
  table: Record<string, string>,
  fallback: string
): string {
  const key = (raw || '').trim()
  return table[key] || fallback
}
