import { describe, expect, it } from 'vitest'
import { bishkekCutoffToIso, isVisibilityActive, remainingSeconds } from './publicVisibility.js'

describe('public visibility time model', () => {
  const morning = new Date('2026-11-13T02:00:00.000Z') // 08:00 Asia/Bishkek

  it('converts a same-day Bishkek cutoff to UTC', () => {
    expect(bishkekCutoffToIso('20:00', morning)).toBe('2026-11-13T14:00:00.000Z')
  })

  it('rejects past and malformed cutoff values', () => {
    expect(() => bishkekCutoffToIso('07:59', morning)).toThrow('CUTOFF_MUST_BE_FUTURE')
    expect(() => bishkekCutoffToIso('25:00', morning)).toThrow('INVALID_CUTOFF_TIME')
  })

  it('treats expiry as inactive', () => {
    const grant = { enabled: true, expiresAt: '2026-11-13T02:00:10.000Z' }
    expect(isVisibilityActive(grant, morning)).toBe(true)
    expect(remainingSeconds(grant, morning)).toBe(10)
    expect(isVisibilityActive(grant, new Date('2026-11-13T02:00:10.000Z'))).toBe(false)
  })
})
