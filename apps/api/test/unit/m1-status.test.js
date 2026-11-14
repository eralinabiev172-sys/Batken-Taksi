import { describe, expect, it } from 'vitest'
import { deriveDriverState, DRIVER_STATUSES } from '../../src/lib/driver-profile-status.js'

describe('driver profile status rule (no database)', () => {
  it('defaults a new profile to pending/false', () => {
    expect(deriveDriverState()).toEqual({ status: 'pending', is_active: false })
    expect(deriveDriverState({ is_active: true })).toEqual({ status: 'pending', is_active: false })
  })

  it.each([true, false])('does not treat legacy is_active=%s as approval or suspension', (is_active) => {
    expect(deriveDriverState({}, { is_active })).toEqual({ status: 'pending', is_active: false })
  })

  it.each(DRIVER_STATUSES)('derives the legacy boolean on insert: %s', (status) => {
    expect(deriveDriverState({ status, is_active: status !== 'active' })).toEqual({ status, is_active: status === 'active' })
  })

  for (const oldStatus of DRIVER_STATUSES) {
    it.each(DRIVER_STATUSES)(`derives the boolean on transition from ${oldStatus} to %s`, (status) => {
      expect(deriveDriverState({ status }, { status: oldStatus, is_active: oldStatus === 'active' }))
        .toEqual({ status, is_active: status === 'active' })
    })
  }

  it.each(DRIVER_STATUSES)('rejects an independent boolean change for %s', (status) => {
    const previous = { status, is_active: status === 'active' }
    expect(() => deriveDriverState({ is_active: !previous.is_active }, previous)).toThrow(/derived/)
    expect(deriveDriverState({}, previous)).toEqual(previous)
  })

  it.each([null, '', 'disabled', 'ACTIVE'])('rejects an invalid status %s', (status) => {
    expect(() => deriveDriverState({ status })).toThrow(/Invalid/)
  })
})
