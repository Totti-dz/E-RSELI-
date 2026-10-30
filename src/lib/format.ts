const dzd = new Intl.NumberFormat('fr-DZ')

export const formatDzd = (amount: number) => `${dzd.format(amount)} دج`

const pad = (value: number) => String(value).padStart(2, '0')

/**
 * Deterministic short timestamp: `29/10 · 18:37` (24-hour, no AM/PM marker).
 * `toLocaleString('ar-DZ')` returns a string whose bidi ordering differs
 * between browsers, and mixing an Arabic ص/م marker inside RTL sentences made
 * the date and the time swap places. Digits, `/`, `·` and `:` are direction
 * neutral, so this value reads the same inside RTL and LTR text.
 */
export function formatWhen(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)} · ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
