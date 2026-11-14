import { readFileSync } from 'node:fs'
import pg from 'pg'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadConfig, parseDatabaseUrl } from '../../src/config/env.js'
import {
  DriverEnvironmentError,
  POOL_APPLICATION_NAME,
  POOL_SESSION_OPTIONS,
  UNSAFE_DRIVER_ENV,
  assertSafeDriverEnvironment,
  createPool,
  poolOptions,
} from '../../src/plugins/db.js'
import { serializeException } from '../../src/lib/safe-diagnostics.js'
import { validateTestTargets } from '../../scripts/test-database-safety.js'

// Synthetic fixtures only. No connection is ever opened: `new pg.Client(...)` does not
// connect, and getStartupConf() returns exactly what would be sent in the startup packet.
const PW = 'fixture-m32-password'
const URL_OK = `postgres://busway_app:${PW}@127.0.0.1:5432/busway`
const config = { databaseUrl: URL_OK, dbPoolMax: 5 }
const driver = (cfg = config) => new pg.Client(poolOptions(cfg))
const summary = (client) => {
  const c = client.connectionParameters
  return {
    startup: client.getStartupConf(),
    host: c.host, port: c.port, database: c.database, user: c.user, ssl: c.ssl,
    sslnegotiation: c.sslnegotiation, client_encoding: c.client_encoding,
    connect_timeout: c.connect_timeout, passwordMatches: c.password === PW,
  }
}

const HOSTILE = {
  PGOPTIONS: '-c role=postgres -c statement_timeout=0 -c search_path=evil -c default_transaction_read_only=off',
  PGAPPNAME: 'forged-application',
  PGCONNECT_TIMEOUT: '1',
  PGHOST: 'evil.example', PGPORT: '9999', PGUSER: 'postgres', PGDATABASE: 'other', PGPASSWORD: 'env-password',
  PGSSLMODE: 'require', PGSSLNEGOTIATION: 'direct', PGCLIENT_ENCODING: 'latin1',
  PGSERVICE: 'evil', PGPASSFILE: 'C:\\evil\\pgpass', PGSYSCONFDIR: 'C:\\evil', PGKRBSRVNAME: 'evil',
  PGGSSENCMODE: 'require', PGTARGETSESSIONATTRS: 'read-write', PGCHANNELBINDING: 'require',
  PGREQUIRESSL: '1', PGLOCALEDIR: 'C:\\evil', PGDATESTYLE: 'evil', PGTZ: 'evil', PGGEQO: 'off',
}

afterEach(() => vi.unstubAllEnvs())

describe('final parameters handed to the pg driver', () => {
  it('are the fixed approved values with fixed session settings', () => {
    const result = summary(driver())
    expect(result).toEqual({
      startup: {
        user: 'busway_app', database: 'busway',
        application_name: POOL_APPLICATION_NAME,
        statement_timeout: '15000',
        options: POOL_SESSION_OPTIONS,
      },
      host: '127.0.0.1', port: 5432, database: 'busway', user: 'busway_app', ssl: false,
      sslnegotiation: 'postgres', client_encoding: 'utf8', connect_timeout: 5, passwordMatches: true,
    })
  })

  it('are identical under a hostile PG* environment (the final startup packet, not just URL parsing)', () => {
    const clean = summary(driver())
    for (const [name, value] of Object.entries(HOSTILE)) vi.stubEnv(name, value)
    const hostile = summary(driver())
    expect(hostile).toEqual(clean)
    const text = JSON.stringify(hostile.startup)
    for (const forbidden of ['role', 'search_path', 'forged', 'evil', 'read_only', 'statement_timeout=0']) {
      expect(text, forbidden).not.toContain(forbidden)
    }
  })

  it.each(Object.keys(HOSTILE))('%s alone does not change any parameter', (name) => {
    const clean = summary(driver())
    vi.stubEnv(name, HOSTILE[name])
    expect(summary(driver())).toEqual(clean)
  })

  it('PGOPTIONS cannot override the statement timeout nor select a role', () => {
    vi.stubEnv('PGOPTIONS', '-c role=postgres -c statement_timeout=0')
    const { options, statement_timeout } = driver().getStartupConf()
    expect(options).toBe('-c statement_timeout=15000')
    expect(statement_timeout).toBe('15000')
    expect(options).not.toMatch(/role/i)
  })

  it('PGAPPNAME cannot rename the session', () => {
    vi.stubEnv('PGAPPNAME', 'forged')
    expect(driver().getStartupConf().application_name).toBe('busway-api')
  })

  it('PGCONNECT_TIMEOUT is not read because the connection timeout is explicit', () => {
    vi.stubEnv('PGCONNECT_TIMEOUT', '999')
    expect(driver().connectionParameters.connect_timeout).toBe(5)
  })

  it('PGSSLNEGOTIATION=direct (which would make the driver throw) and PGCLIENT_ENCODING (silent mojibake) are neutralised', () => {
    vi.stubEnv('PGSSLNEGOTIATION', 'direct')
    vi.stubEnv('PGCLIENT_ENCODING', 'latin1')
    expect(() => driver()).not.toThrow()
    expect(driver().connectionParameters).toMatchObject({ sslnegotiation: 'postgres', client_encoding: 'utf8' })
  })

  it('the pool object receives the same explicit options and its size limit', () => {
    vi.stubEnv('PGOPTIONS', '-c role=postgres')
    const pool = new pg.Pool(poolOptions(config))
    expect(pool.options).toMatchObject({ max: 5, application_name: 'busway-api', options: POOL_SESSION_OPTIONS, ssl: false })
    expect(pool.options.connectionString).toBeUndefined()
  })

  it('keeps the approved M3 connection parameters unchanged', () => {
    const approved = parseDatabaseUrl(URL_OK)
    const options = poolOptions(config)
    expect(options).toMatchObject({ host: approved.host, port: approved.port, database: approved.database, user: approved.user, password: approved.password, ssl: false })
  })

  it('uses the same session options as the HIGH test guard', () => {
    const url = (user, database) => `postgres://${user}:${PW}@127.0.0.1:5432/${database}`
    const targets = validateTestTargets({
      BUSWAY_ALLOW_DESTRUCTIVE_TESTS: 'busway_test',
      DATABASE_URL: url('busway_app', 'busway'),
      MIGRATOR_DATABASE_URL: url('busway_migrator', 'busway'),
      TEST_DATABASE_URL: url('busway_app', 'busway_test'),
      TEST_MIGRATOR_DATABASE_URL: url('busway_migrator', 'busway_test'),
    })
    expect(targets.TEST_DATABASE_URL.options).toBe(POOL_SESSION_OPTIONS)
  })
})

describe('passwords stay intact under a hostile environment', () => {
  it.each([
    'hex' + 'a'.repeat(44), "p@ss:w/rd?#%&=+ ;'\"\\", 'ünïcode-пароль-密码', 'a b', '%41', '%', '+', 'x'.repeat(500),
  ])('round-trips %j through config, pool options and the startup path', (password) => {
    for (const [name, value] of Object.entries(HOSTILE)) vi.stubEnv(name, value)
    const url = `postgres://busway_app:${encodeURIComponent(password)}@127.0.0.1:5432/busway`
    const loaded = loadConfig({ DATABASE_URL: url })
    const client = new pg.Client(poolOptions(loaded))
    expect(client.connectionParameters.password).toBe(password)
    expect(client.connectionParameters.host).toBe('127.0.0.1')
  })
})

describe('variables that explicit settings cannot neutralise', () => {
  it('documents the pg behaviour that makes PGREPLICATION unsafe (characterisation, no connection)', () => {
    vi.stubEnv('PGREPLICATION', 'database')
    // If a future pg version stops inheriting this, the test fails and the guard can be revisited.
    expect(driver().getStartupConf().replication).toBe('database')
  })

  it('PGBINARY has no effect on the client in this pg version (pinned; revisit on upgrade)', () => {
    vi.stubEnv('PGBINARY', '1')
    const client = driver()
    expect(client.connectionParameters.binary).toBeTruthy()
    expect(client.binary).toBeFalsy()
    expect(() => assertSafeDriverEnvironment({ PGBINARY: '1' })).not.toThrow()
  })

  it('the installed pg is the version these findings were verified against', () => {
    const version = JSON.parse(readFileSync(new URL('../../../../node_modules/pg/package.json', import.meta.url), 'utf8')).version
    expect(version).toMatch(/^8\./)
  })

  it.each(UNSAFE_DRIVER_ENV)('refuses to start when %s is set, naming the variable but not its value', (name) => {
    const SECRET_VALUE = 'fixture-value-m32'
    let caught
    try { assertSafeDriverEnvironment({ [name]: SECRET_VALUE }) } catch (error) { caught = error }
    expect(caught).toBeInstanceOf(DriverEnvironmentError)
    expect(caught.message).toContain(name)
    expect(caught.message).not.toContain(SECRET_VALUE)
    expect(caught.code).toBe('CONFIG_ERROR')
    // M3.4: the log keeps the fixed code and the fixed "VARIABLE: reason" pair, still no value.
    expect(serializeException(caught)).toEqual({ type: 'UnknownError', code: 'CONFIG_ERROR', problems: [`${name}: unsafe_driver_env`] })
    vi.stubEnv(name, SECRET_VALUE)
    expect(() => createPool(config)).toThrow(DriverEnvironmentError)
  })

  it('the refusal list is exactly PGREPLICATION and is not driven by the exported list itself', () => {
    // An it.each over UNSAFE_DRIVER_ENV would silently produce zero tests if the list were emptied.
    expect(UNSAFE_DRIVER_ENV).toEqual(['PGREPLICATION'])
    expect(() => assertSafeDriverEnvironment({ PGREPLICATION: 'database' })).toThrow(/PGREPLICATION/)
    expect(() => assertSafeDriverEnvironment({ PGREPLICATION: 'true' })).toThrow(DriverEnvironmentError)
    vi.stubEnv('PGREPLICATION', 'database')
    expect(() => createPool(config)).toThrow(/PGREPLICATION/)
  })

  it('does not trigger on empty values, which pg itself treats as unset', () => {
    expect(() => assertSafeDriverEnvironment({ PGBINARY: '', PGREPLICATION: '' })).not.toThrow()
    expect(() => assertSafeDriverEnvironment({})).not.toThrow()
    expect(() => assertSafeDriverEnvironment({ PGOPTIONS: 'anything', PGAPPNAME: 'x' })).not.toThrow()
    expect(createPool(config)).toBeInstanceOf(pg.Pool)
  })
})

describe('diagnostics and documentation', () => {
  it('no diagnostic output contains the password or a hostile variable value', () => {
    for (const [name, value] of Object.entries(HOSTILE)) vi.stubEnv(name, value)
    const options = poolOptions(config)
    const withoutPassword = JSON.stringify({ ...options, password: undefined })
    expect(withoutPassword).not.toContain(PW)
    // 'postgres' (PGUSER) legitimately appears as the sslnegotiation value, so only distinctive values are checked.
    for (const value of [HOSTILE.PGOPTIONS, HOSTILE.PGAPPNAME, HOSTILE.PGHOST, HOSTILE.PGPASSWORD, HOSTILE.PGPASSFILE, HOSTILE.PGSERVICE, 'latin1']) {
      expect(withoutPassword, value).not.toContain(value)
    }
  })

  it('.env.example documents encoding, the fixed profile and BUSWAY_DB_PORT, and keeps DB_POOL_MAX=5', () => {
    const example = readFileSync(new URL('../../../../.env.example', import.meta.url), 'utf8')
    expect(example).toMatch(/percent-encoded/)
    expect(example).toMatch(/127\.0\.0\.1:5432/)
    expect(example).toMatch(/BUSWAY_DB_PORT is NOT a free choice/)
    expect(example).toMatch(/^DB_POOL_MAX=5$/m)
    expect(example).toMatch(/PGREPLICATION cannot be neutralised/)
  })
})
