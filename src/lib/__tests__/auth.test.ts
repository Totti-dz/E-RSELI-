import { describe, expect, it } from 'vitest'
import { normalizePhone, passwordProblem, phoneToEmail } from '../auth'

describe('Algerian phone normalisation', () => {
  it('accepts local, international and spaced formats', () => {
    expect(normalizePhone('0551234567')).toEqual({ ok: true, e164: '+213551234567' })
    expect(normalizePhone('+213551234567')).toEqual({ ok: true, e164: '+213551234567' })
    expect(normalizePhone('00213551234567')).toEqual({ ok: true, e164: '+213551234567' })
    expect(normalizePhone('05 51 23 45 67')).toEqual({ ok: true, e164: '+213551234567' })
    expect(normalizePhone('0551-234-567')).toEqual({ ok: true, e164: '+213551234567' })
  })

  it('accepts Arabic-Indic digits typed on an Arabic keyboard', () => {
    expect(normalizePhone('٠٥٥١٢٣٤٥٦٧')).toEqual({ ok: true, e164: '+213551234567' })
  })

  it('rejects empty, short, and non-mobile numbers', () => {
    expect(normalizePhone('').ok).toBe(false)
    expect(normalizePhone('   ').ok).toBe(false)
    expect(normalizePhone('05512345').ok).toBe(false)
    expect(normalizePhone('0451234567').ok).toBe(false)
    expect(normalizePhone('05512345678').ok).toBe(false)
  })

  it('builds a stable synthetic email per phone number', () => {
    expect(phoneToEmail('+213551234567')).toBe('213551234567@phone.ersel.app')
  })
})

describe('password policy', () => {
  it('requires at least 8 characters with a letter and a digit', () => {
    expect(passwordProblem('short1')).toBeTruthy()
    expect(passwordProblem('allletters')).toBeTruthy()
    expect(passwordProblem('12345678')).toBeTruthy()
    expect(passwordProblem('ersel2026')).toBeNull()
    expect(passwordProblem('إرسلي2026')).toBeNull()
  })
})
