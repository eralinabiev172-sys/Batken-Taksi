import { describe, expect, it } from 'vitest'
import { isPublicId, newInternalId, newPublicId } from '../../src/lib/ids.js'

describe('identifiers (D-107)', () => {
  it('internal ids are UUIDs', () => {
    expect(newInternalId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('public ids are opaque, prefixed and valid', () => {
    const id = newPublicId('bus')
    expect(id).toMatch(/^bus_[A-Za-z0-9_-]{22}$/)
    expect(isPublicId(id)).toBe(true)
  })

  it('public ids do not look like internal UUIDs and are not derived from them', () => {
    expect(isPublicId(newInternalId())).toBe(false)
    expect(newPublicId('bus')).not.toContain(newInternalId())
  })

  it('generates distinct values', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newPublicId('bus')))
    expect(ids.size).toBe(1000)
  })

  it('rejects bad prefixes and non-string input', () => {
    expect(() => newPublicId('BUS')).toThrow(TypeError)
    expect(() => newPublicId('b')).toThrow(TypeError)
    expect(() => newPublicId('bus_x')).toThrow(TypeError)
    expect(isPublicId(null)).toBe(false)
    expect(isPublicId('bus_short')).toBe(false)
  })
})
