import { describe, expect, it } from 'vitest'

describe('auth cookie names', () => {
  it('development uses non-prefixed names', async () => {
    process.env.NODE_ENV = 'test'
    const m = await import('../../src/plugins/auth.js?dev')
    expect(m.SESSION_COOKIE).toBe('session')
    expect(m.CSRF_COOKIE).toBe('csrf')
  })
  it('production uses __Host- prefixed names', async () => {
    process.env.NODE_ENV = 'production'
    const m = await import('../../src/plugins/auth.js?prod')
    expect(m.SESSION_COOKIE).toBe('__Host-session')
    expect(m.CSRF_COOKIE).toBe('__Host-csrf')
  })
})