import { describe, expect, it } from 'vitest'
import Value from 'typebox/value'
import {
  ErrorCodes,
  ErrorResponseSchema,
  HealthResponseSchema,
  PublicIdSchema,
} from '../src/index.js'

describe('error contract', () => {
  it('accepts the documented error shape', () => {
    const ok = { error: { code: ErrorCodes.NOT_FOUND, message: 'x', requestId: 'r1' } }
    expect(Value.Check(ErrorResponseSchema, ok)).toBe(true)
  })

  it('accepts details with path and message only', () => {
    const ok = {
      error: {
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'x',
        requestId: 'r1',
        details: [{ path: '/a', message: 'must be string' }],
      },
    }
    expect(Value.Check(ErrorResponseSchema, ok)).toBe(true)
  })

  it('rejects unexpected fields', () => {
    const bad = { error: { code: 'X', message: 'x', requestId: 'r', stack: 'secret' } }
    expect(Value.Check(ErrorResponseSchema, bad)).toBe(false)
    expect(Value.Check(ErrorResponseSchema, { error: bad.error, extra: 1 })).toBe(false)
  })

  it('error codes are frozen', () => {
    expect(Object.isFrozen(ErrorCodes)).toBe(true)
  })
})

describe('common contracts', () => {
  it('public id must be prefix + 22 url-safe chars', () => {
    expect(Value.Check(PublicIdSchema, 'bus_AAAAAAAAAAAAAAAAAAAAAA')).toBe(true)
    expect(Value.Check(PublicIdSchema, '3f2504e0-4f89-11d3-9a0c-0305e82c3301')).toBe(false)
    expect(Value.Check(PublicIdSchema, 'bus_short')).toBe(false)
  })

  it('health response is strict', () => {
    expect(Value.Check(HealthResponseSchema, { status: 'ok' })).toBe(true)
    expect(Value.Check(HealthResponseSchema, { status: 'ok', version: '1' })).toBe(false)
  })
})
