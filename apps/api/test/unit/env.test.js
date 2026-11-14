import { describe, expect, it } from 'vitest'
import { ConfigError, loadConfig } from '../../src/config/env.js'

const SECRET = 'p4ssw0rd-do-not-leak'
const valid = { DATABASE_URL: `postgres://busway_app:${SECRET}@127.0.0.1:5432/busway` }

describe('loadConfig', () => {
  it('applies safe defaults', () => {
    const config = loadConfig(valid)
    expect(config.host).toBe('127.0.0.1')
    expect(config.port).toBe(3001)
    expect(config.nodeEnv).toBe('development')
    expect(config.dbPoolMax).toBe(5)
  })

  it('reads explicit values and coerces integers', () => {
    const config = loadConfig({ ...valid, PORT: '4000', DB_POOL_MAX: '5', NODE_ENV: 'test', LOG_LEVEL: 'silent' })
    expect(config.port).toBe(4000)
    expect(config.dbPoolMax).toBe(5)
    expect(config.nodeEnv).toBe('test')
  })

  it('returns a frozen object', () => {
    expect(Object.isFrozen(loadConfig(valid))).toBe(true)
  })

  it('fails fast when DATABASE_URL is missing', () => {
    expect(() => loadConfig({})).toThrow(ConfigError)
    expect(() => loadConfig({})).toThrow(/DATABASE_URL is required/)
  })

  it.each([
    [{ PORT: 'abc' }, /PORT/],
    [{ PORT: '0' }, /PORT/],
    [{ PORT: '70000' }, /PORT/],
    [{ NODE_ENV: 'staging' }, /NODE_ENV/],
    [{ LOG_LEVEL: 'loud' }, /LOG_LEVEL/],
    [{ DB_POOL_MAX: '0' }, /DB_POOL_MAX/],
    [{ DATABASE_URL: 'mysql://x' }, /DATABASE_URL/],
  ])('rejects invalid value %j', (override, pattern) => {
    expect(() => loadConfig({ ...valid, ...override })).toThrow(pattern)
  })

  it('never echoes values, including the database password', () => {
    for (const env of [{ DATABASE_URL: `mysql://u:${SECRET}@h/db` }, { ...valid, PORT: 'secret-port' }]) {
      let caught
      try {
        loadConfig(env)
      } catch (error) {
        caught = error
      }
      expect(caught).toBeInstanceOf(ConfigError)
      expect(caught.message).not.toContain(SECRET)
      expect(caught.message).not.toContain('secret-port')
    }
  })

  it('refuses a public bind address unless explicitly allowed', () => {
    expect(() => loadConfig({ ...valid, HOST: '0.0.0.0' })).toThrow(/loopback/)
    expect(loadConfig({ ...valid, HOST: '0.0.0.0', ALLOW_NON_LOOPBACK_HOST: 'true' }).host).toBe('0.0.0.0')
    expect(loadConfig({ ...valid, HOST: '::1' }).host).toBe('::1')
  })
})
