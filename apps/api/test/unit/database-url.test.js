import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  APPROVED_LOCAL_DATABASE,
  ConfigError,
  DB_MAX_CONNECTIONS,
  DB_POOL_MAX_DEFAULT,
  DB_POOL_MAX_LIMIT,
  DB_SUPERUSER_RESERVED,
  DatabaseUrlError,
  loadConfig,
  parseDatabaseUrl,
} from '../../src/config/env.js'
import { poolOptions } from '../../src/plugins/db.js'
import { validateTestTargets } from '../../scripts/test-database-safety.js'

// Synthetic fixtures only. The real .env is never read by these tests.
const P = 'fixture-m3-secret'
const GOOD = `postgres://busway_app:${P}@127.0.0.1:5432/busway`
const read = (path) => readFileSync(new URL(`../../../../${path}`, import.meta.url), 'utf8')

function failure(env) {
  try {
    loadConfig(env)
  } catch (error) {
    return error
  }
  return undefined
}

describe('approved local database URL', () => {
  it('accepts the approved URL and returns explicit driver options', () => {
    expect(parseDatabaseUrl(GOOD)).toEqual({ host: '127.0.0.1', port: 5432, database: 'busway', user: 'busway_app', password: P, ssl: false })
    expect(parseDatabaseUrl(GOOD.replace('postgres://', 'postgresql://')).database).toBe('busway')
    expect(loadConfig({ DATABASE_URL: GOOD }).databaseUrl).toBe(GOOD)
  })

  it('decodes percent-encoded passwords without exposing them', () => {
    expect(parseDatabaseUrl(`postgres://busway_app:p%40ss%3Aw%25rd@127.0.0.1:5432/busway`).password).toBe('p@ss:w%rd')
  })

  it.each([
    ['unsupported protocol', `mysql://busway_app:${P}@127.0.0.1:5432/busway`, 'scheme'],
    ['http protocol', `http://busway_app:${P}@127.0.0.1:5432/busway`, 'scheme'],
    ['missing host', 'postgres://', 'host missing'],
    ['remote host', `postgres://busway_app:${P}@192.0.2.1:5432/busway`, 'host'],
    ['ambiguous hostname', `postgres://busway_app:${P}@localhost:5432/busway`, 'host'],
    ['IPv6 loopback', `postgres://busway_app:${P}@[::1]:5432/busway`, 'host'],
    ['missing port', `postgres://busway_app:${P}@127.0.0.1/busway`, 'port missing'],
    ['wrong port', `postgres://busway_app:${P}@127.0.0.1:55432/busway`, 'port'],
    ['port used by another local service', `postgres://busway_app:${P}@127.0.0.1:5433/busway`, 'port'],
    ['missing database', `postgres://busway_app:${P}@127.0.0.1:5432`, 'database missing'],
    ['empty database path', `postgres://busway_app:${P}@127.0.0.1:5432/`, 'database missing'],
    ['another database', `postgres://busway_app:${P}@127.0.0.1:5432/unrelated_db`, 'database'],
    ['extra path segment', `postgres://busway_app:${P}@127.0.0.1:5432/busway/extra`, 'database'],
    ['test database as working database', `postgres://busway_app:${P}@127.0.0.1:5432/busway_test`, 'test database'],
    ['encoded test database', `postgres://busway_app:${P}@127.0.0.1:5432/busway%5Ftest`, 'test database'],
    ['missing user', `postgres://:${P}@127.0.0.1:5432/busway`, 'user missing'],
    ['migrator role as working role', `postgres://busway_migrator:${P}@127.0.0.1:5432/busway`, 'user'],
    ['superuser role', `postgres://busway_admin:${P}@127.0.0.1:5432/busway`, 'user'],
    ['missing password', 'postgres://busway_app@127.0.0.1:5432/busway', 'password missing'],
    ['empty password', 'postgres://busway_app:@127.0.0.1:5432/busway', 'password missing'],
    ['query override', `${GOOD}?host=192.0.2.1`, 'unexpected parameters'],
    ['session options', `${GOOD}?options=-crole%3Dpostgres`, 'unexpected parameters'],
    ['ssl parameter', `${GOOD}?sslmode=disable`, 'unexpected parameters'],
    ['dangling question mark', `${GOOD}?`, 'unexpected parameters'],
    ['fragment', `${GOOD}#x`, 'unexpected parameters'],
    ['leading whitespace', ` ${GOOD}`, 'malformed'],
    ['embedded newline', `${GOOD}\n`, 'malformed'],
    ['backslash', GOOD.replace('/busway', '\\busway'), 'malformed'],
    ['bad percent-encoding', `postgres://busway_app:%E0%A4%A@127.0.0.1:5432/busway`, 'malformed'],
    ['non-numeric port', `postgres://busway_app:${P}@127.0.0.1:abc/busway`, 'malformed'],
    ['out-of-range port', `postgres://busway_app:${P}@127.0.0.1:65536/busway`, 'malformed'],
  ])('rejects %s without echoing any value', (_name, url, reason) => {
    let caught
    try { parseDatabaseUrl(url) } catch (error) { caught = error }
    expect(caught).toBeInstanceOf(DatabaseUrlError)
    expect(caught.reason).toBe(reason)
    const error = failure({ DATABASE_URL: url })
    expect(error).toBeInstanceOf(ConfigError)
    expect(error.message).toMatch(/DATABASE_URL/)
    for (const forbidden of [P, '192.0.2.1', 'unrelated_db', 'busway_admin', 'busway_migrator', 'p%40ss']) {
      expect(error.message, forbidden).not.toContain(forbidden)
      expect(caught.message, forbidden).not.toContain(forbidden)
    }
    expect(error.message).not.toContain('postgres://')
  })

  it.each([undefined, '', null, 123, {}])('rejects an empty or non-string value %j', (value) => {
    expect(() => parseDatabaseUrl(value)).toThrow(DatabaseUrlError)
    expect(failure({ DATABASE_URL: value === undefined ? undefined : String(value ?? '') })).toBeInstanceOf(ConfigError)
  })

  it('does not require approval of anything but the local profile (no production profile yet)', () => {
    expect(() => loadConfig({ DATABASE_URL: GOOD, NODE_ENV: 'production' })).toThrow(/no approved production database profile/)
    expect(loadConfig({ DATABASE_URL: GOOD, NODE_ENV: 'test' }).nodeEnv).toBe('test')
  })

  it('keeps the working connection separate from migration and test connections', () => {
    for (const name of ['MIGRATOR_DATABASE_URL', 'TEST_DATABASE_URL', 'TEST_MIGRATOR_DATABASE_URL']) {
      const error = failure({ DATABASE_URL: GOOD, [name]: GOOD })
      expect(error).toBeInstanceOf(ConfigError)
      expect(error.message).toContain(name)
      expect(error.message).not.toContain(P)
    }
    expect(() => loadConfig({
      DATABASE_URL: GOOD,
      MIGRATOR_DATABASE_URL: GOOD.replace('busway_app', 'busway_migrator'),
      TEST_DATABASE_URL: GOOD.replace('/busway', '/busway_test'),
    })).not.toThrow()
  })

  it('the profile constants are the approved D-137 values', () => {
    expect(APPROVED_LOCAL_DATABASE).toMatchObject({ host: '127.0.0.1', port: '5432', database: 'busway', user: 'busway_app' })
    expect(Object.isFrozen(APPROVED_LOCAL_DATABASE)).toBe(true)
  })
})

describe('driver options (no network access)', () => {
  it('passes explicit fields and never a connectionString', () => {
    const options = poolOptions({ databaseUrl: GOOD, dbPoolMax: 3 })
    expect(options).toMatchObject({ host: '127.0.0.1', port: 5432, database: 'busway', user: 'busway_app', password: P, ssl: false, max: 3 })
    expect(options.connectionString).toBeUndefined()
  })

  it('ignores query parameters that could redirect an unvalidated URL', () => {
    const options = poolOptions({ databaseUrl: `${GOOD}?host=192.0.2.1&dbname=other&user=root`, dbPoolMax: 1 })
    expect(options).toMatchObject({ host: '127.0.0.1', database: 'busway', user: 'busway_app' })
  })
})

describe('DB_POOL_MAX', () => {
  it('uses the safe default', () => {
    expect(loadConfig({ DATABASE_URL: GOOD }).dbPoolMax).toBe(DB_POOL_MAX_DEFAULT)
    expect(DB_POOL_MAX_DEFAULT).toBe(5)
  })

  it.each([1, 5, DB_POOL_MAX_LIMIT])('accepts %i', (value) => {
    expect(loadConfig({ DATABASE_URL: GOOD, DB_POOL_MAX: String(value) }).dbPoolMax).toBe(value)
  })

  it.each(['0', '-1', String(DB_POOL_MAX_LIMIT + 1), '27', '30', '50', '5.5', 'abc', '1e1', ' 5'])('rejects %s', (value) => {
    const error = failure({ DATABASE_URL: GOOD, DB_POOL_MAX: value })
    expect(error).toBeInstanceOf(ConfigError)
    expect(error.message).toMatch(/DB_POOL_MAX/)
    expect(error.message).not.toContain(P)
  })

  it('leaves a reserve of connections for migrations, tests and administration', () => {
    const compose = read('docker-compose.yml')
    expect(Number(compose.match(/max_connections=(\d+)/)[1])).toBe(DB_MAX_CONNECTIONS)
    expect(compose).not.toMatch(/superuser_reserved_connections/)
    const ordinary = DB_MAX_CONNECTIONS - DB_SUPERUSER_RESERVED
    expect(DB_POOL_MAX_LIMIT).toBeLessThanOrEqual(ordinary)
    expect(ordinary - DB_POOL_MAX_LIMIT).toBeGreaterThanOrEqual(10)
    expect(DB_POOL_MAX_DEFAULT).toBeLessThanOrEqual(DB_POOL_MAX_LIMIT)
  })
})

describe('.env.example and the HIGH test-database guard', () => {
  const example = Object.fromEntries(
    read('.env.example').split('\n').filter((line) => /^[A-Z_]+=/.test(line)).map((line) => [line.split('=')[0], line.slice(line.indexOf('=') + 1).trim()]),
  )

  it('the documented example satisfies the validation and the pool limit', () => {
    expect(() => parseDatabaseUrl(example.DATABASE_URL)).not.toThrow()
    expect(Number(example.DB_POOL_MAX)).toBeGreaterThanOrEqual(1)
    expect(Number(example.DB_POOL_MAX)).toBeLessThanOrEqual(DB_POOL_MAX_LIMIT)
  })

  it('the example test and migration URLs are refused as the working URL', () => {
    for (const name of ['MIGRATOR_DATABASE_URL', 'TEST_DATABASE_URL', 'TEST_MIGRATOR_DATABASE_URL']) {
      expect(() => parseDatabaseUrl(example[name]), name).toThrow(DatabaseUrlError)
    }
  })

  it('a configuration accepted here is also accepted by the HIGH guard, and vice versa for its working URLs', () => {
    const env = { ...example, BUSWAY_ALLOW_DESTRUCTIVE_TESTS: 'busway_test' }
    expect(() => validateTestTargets(env)).not.toThrow()
    expect(() => loadConfig(env)).not.toThrow()
    // HIGH requires the same working URL, so a loosened working URL is rejected there too.
    expect(() => validateTestTargets({ ...env, DATABASE_URL: GOOD.replace('/busway', '/busway_test') })).toThrow()
    expect(failure({ ...env, DATABASE_URL: GOOD.replace('/busway', '/busway_test') })).toBeInstanceOf(ConfigError)
  })
})
