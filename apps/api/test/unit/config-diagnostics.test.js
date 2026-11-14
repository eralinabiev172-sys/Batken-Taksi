import { spawnSync } from 'node:child_process'
import { Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import {
  CONFIG_REASONS,
  CONFIG_VARIABLES,
  createDiagnostics,
  isAllowedProblem,
  problemsFromIssued,
  problemsFromLogLine,
} from '../../src/lib/config-diagnostics.js'
import { ConfigError, loadConfig } from '../../src/config/env.js'
import { DriverEnvironmentError, assertSafeDriverEnvironment } from '../../src/plugins/db.js'
import { logSafeException, sanitizeLogLine, serializeException } from '../../src/lib/safe-diagnostics.js'
import { createSafeLogger } from '../../src/plugins/logging.js'

// Synthetic fixtures only. Nothing here connects to a database or starts a listener.
const PW = 'fixture-m34-password'
const url = (o = {}) => `postgres://${o.user ?? 'busway_app'}:${o.pw ?? PW}@${o.host ?? '127.0.0.1'}:${o.port ?? '5432'}/${o.db ?? 'busway'}${o.tail ?? ''}`
const GOOD = url()

const capture = () => {
  let text = ''
  const stream = new Writable({ write(chunk, _e, cb) { text += chunk.toString(); cb() } })
  return { stream, text: () => text, records: () => text.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)) }
}
const failure = (env) => {
  try { loadConfig(env) } catch (error) { return error }
  return undefined
}
const pairs = (error) => error.diagnostics.map((p) => `${p.variable}: ${p.reason}`)

describe('fixed vocabulary', () => {
  it('lists exactly the approved variables and reasons', () => {
    expect(CONFIG_VARIABLES).toEqual(['DATABASE_URL', 'DB_POOL_MAX', 'NODE_ENV', 'HOST', 'PORT', 'LOG_LEVEL', 'PGREPLICATION'])
    expect(CONFIG_REASONS).toEqual([
      'missing', 'empty', 'invalid', 'malformed', 'unexpected_parameters', 'scheme', 'host', 'port', 'database',
      'test_database', 'user', 'password', 'out_of_range', 'same_connection', 'non_loopback', 'unsafe_driver_env', 'no_production_profile',
    ])
    expect(Object.isFrozen(CONFIG_VARIABLES) && Object.isFrozen(CONFIG_REASONS)).toBe(true)
  })
})

describe('every configuration refusal maps to one fixed diagnostic', () => {
  it.each([
    ['missing DATABASE_URL', {}, ['DATABASE_URL: missing']],
    ['empty DATABASE_URL', { DATABASE_URL: '' }, ['DATABASE_URL: empty']],
    ['wrong scheme', { DATABASE_URL: url().replace('postgres://', 'mysql://') }, ['DATABASE_URL: scheme']],
    ['wrong host', { DATABASE_URL: url({ host: '192.0.2.1' }) }, ['DATABASE_URL: host']],
    ['missing host', { DATABASE_URL: 'postgres://' }, ['DATABASE_URL: host']],
    ['wrong port', { DATABASE_URL: url({ port: '5433' }) }, ['DATABASE_URL: port']],
    ['missing port', { DATABASE_URL: `postgres://busway_app:${PW}@127.0.0.1/busway` }, ['DATABASE_URL: port']],
    ['wrong database', { DATABASE_URL: url({ db: 'unrelated' }) }, ['DATABASE_URL: database']],
    ['missing database', { DATABASE_URL: `postgres://busway_app:${PW}@127.0.0.1:5432` }, ['DATABASE_URL: database']],
    ['test database as working database', { DATABASE_URL: url({ db: 'busway_test' }) }, ['DATABASE_URL: test_database']],
    ['wrong role', { DATABASE_URL: url({ user: 'busway_migrator' }) }, ['DATABASE_URL: user']],
    ['missing role', { DATABASE_URL: `postgres://:${PW}@127.0.0.1:5432/busway` }, ['DATABASE_URL: user']],
    ['missing password', { DATABASE_URL: 'postgres://busway_app@127.0.0.1:5432/busway' }, ['DATABASE_URL: password']],
    ['query parameters', { DATABASE_URL: url({ tail: '?host=evil' }) }, ['DATABASE_URL: unexpected_parameters']],
    ['malformed URL', { DATABASE_URL: ` ${GOOD}` }, ['DATABASE_URL: malformed']],
    ['same as a migration/test connection', { DATABASE_URL: GOOD, TEST_DATABASE_URL: GOOD }, ['DATABASE_URL: same_connection']],
    ['DB_POOL_MAX too high', { DATABASE_URL: GOOD, DB_POOL_MAX: '11' }, ['DB_POOL_MAX: out_of_range']],
    ['DB_POOL_MAX too low', { DATABASE_URL: GOOD, DB_POOL_MAX: '0' }, ['DB_POOL_MAX: out_of_range']],
    ['DB_POOL_MAX not a number', { DATABASE_URL: GOOD, DB_POOL_MAX: 'abc' }, ['DB_POOL_MAX: invalid']],
    ['NODE_ENV=production', { DATABASE_URL: GOOD, NODE_ENV: 'production' }, ['NODE_ENV: no_production_profile']],
    ['unknown NODE_ENV', { DATABASE_URL: GOOD, NODE_ENV: 'staging' }, ['NODE_ENV: invalid']],
    ['PORT out of range', { DATABASE_URL: GOOD, PORT: '70000' }, ['PORT: out_of_range']],
    ['PORT not a number', { DATABASE_URL: GOOD, PORT: 'abc' }, ['PORT: invalid']],
    ['LOG_LEVEL unknown', { DATABASE_URL: GOOD, LOG_LEVEL: 'loud' }, ['LOG_LEVEL: invalid']],
    ['non-loopback HOST', { DATABASE_URL: GOOD, HOST: '0.0.0.0' }, ['HOST: non_loopback']],
  ])('%s', (_name, env, expected) => {
    const error = failure(env)
    expect(error).toBeInstanceOf(ConfigError)
    expect(error.code).toBe('CONFIG_ERROR')
    // Equality with a non-empty expectation also proves nothing was dropped as out-of-vocabulary.
    expect(pairs(error)).toEqual(expected)
    // Several developer messages may share one diagnostic (typebox reports one per union member).
    expect(error.diagnostics.length).toBeLessThanOrEqual(error.problems.length)
  })

  it('reports several refusals together and without duplicates', () => {
    const error = failure({ DATABASE_URL: url({ db: 'busway_test' }), DB_POOL_MAX: '99', NODE_ENV: 'production', PORT: 'x' })
    expect(pairs(error)).toEqual(expect.arrayContaining(['DATABASE_URL: test_database', 'DB_POOL_MAX: out_of_range', 'PORT: invalid']))
    expect(new Set(pairs(error)).size).toBe(pairs(error).length)
  })

  it('PGREPLICATION is reported by the driver environment check', () => {
    let caught
    try { assertSafeDriverEnvironment({ PGREPLICATION: 'secret-value-m34' }) } catch (error) { caught = error }
    expect(caught).toBeInstanceOf(DriverEnvironmentError)
    expect(pairs(caught)).toEqual(['PGREPLICATION: unsafe_driver_env'])
    expect(caught.code).toBe('CONFIG_ERROR')
    expect(JSON.stringify(caught.diagnostics)).not.toContain('secret-value-m34')
  })

  it('no reported pair contains a value, and every pair is inside the vocabulary', () => {
    for (const env of [{}, { DATABASE_URL: url({ db: 'busway_test' }) }, { DATABASE_URL: url({ host: 'evil.example' }) }]) {
      for (const pair of failure(env).diagnostics) expect(isAllowedProblem(pair.variable, pair.reason)).toBe(true)
    }
  })
})

describe('provenance and vocabulary enforcement', () => {
  it('rejects pairs outside the vocabulary and free text instead of a code', () => {
    const list = createDiagnostics([
      { variable: 'DATABASE_URL', reason: 'test_database' },
      { variable: 'DATABASE_URL', reason: `postgres://u:${PW}@h/db` },
      { variable: 'PGOPTIONS', reason: 'unsafe_driver_env' },
      { variable: `DATABASE_URL=${PW}`, reason: 'host' },
      { variable: 'DATABASE_URL', reason: 'Host' },
      { variable: 'DATABASE_URL', reason: 'test_database' },
      null, undefined, 42, 'DATABASE_URL: host', { variable: ['DATABASE_URL'], reason: ['host'] },
    ])
    expect(list.map((p) => `${p.variable}: ${p.reason}`)).toEqual(['DATABASE_URL: test_database'])
    expect(Object.isFrozen(list)).toBe(true)
  })

  it('an error object with a forged, copied or request-built diagnostics property is not trusted', () => {
    const real = failure({ DATABASE_URL: url({ db: 'busway_test' }) })
    const forged = Object.assign(new Error('x'), { diagnostics: [{ variable: 'DATABASE_URL', reason: 'host' }] })
    const copied = Object.assign(new Error('x'), { diagnostics: [...real.diagnostics] })
    const fromRequest = Object.assign(new Error('x'), { diagnostics: JSON.parse(JSON.stringify(real.diagnostics)) })
    const frozenForgery = Object.assign(new Error('x'), { diagnostics: Object.freeze([Object.freeze({ variable: 'DATABASE_URL', reason: 'host' })]) })
    for (const error of [forged, copied, fromRequest, frozenForgery]) {
      expect(serializeException(error).problems).toBeUndefined()
    }
    expect(serializeException(real).problems).toEqual(['DATABASE_URL: test_database'])
  })

  it('does not run getters or toJSON on a hostile diagnostics property', () => {
    const getter = vi.fn(() => { throw new Error(PW) })
    const hostile = new Error('x')
    Object.defineProperty(hostile, 'diagnostics', { get: getter })
    expect(serializeException(hostile).problems).toBeUndefined()
    expect(getter).not.toHaveBeenCalled()
  })

  it('log-line re-validation keeps only exact vocabulary strings', () => {
    expect(problemsFromLogLine([
      'DATABASE_URL: test_database', 'DATABASE_URL: test_database', `DATABASE_URL: postgres://u:${PW}@h/db`,
      'PGOPTIONS: unsafe_driver_env', 'DATABASE_URL:test_database', ' DATABASE_URL: host', 'DATABASE_URL: host ', 'HOST: non_loopback', 7, null, {},
    ])).toEqual(['DATABASE_URL: test_database', 'HOST: non_loopback'])
    expect(problemsFromLogLine('DATABASE_URL: host')).toEqual([])
    expect(problemsFromLogLine(Array.from({ length: 100 }, () => 'HOST: non_loopback'))).toEqual(['HOST: non_loopback'])
    expect(problemsFromIssued(['DATABASE_URL: host'])).toEqual([])
  })
})

describe('final Pino output (not helper return values)', () => {
  const hostileEnv = () => ({ DATABASE_URL: url({ db: 'busway_test', pw: 'p@ss%3Aw%2Frd' }), DB_POOL_MAX: '99' })

  it('writes the fixed event, a safe code and only "VARIABLE: reason" strings', () => {
    const sink = capture()
    const log = createSafeLogger({ logLevel: 'info' }, sink.stream)
    logSafeException(log, failure(hostileEnv()), 'configuration_invalid')
    const [record] = sink.records()
    expect(record).toMatchObject({ msg: 'invalid configuration', err: { type: 'UnknownError', code: 'CONFIG_ERROR' } })
    expect([...record.err.problems].sort()).toEqual(['DATABASE_URL: test_database', 'DB_POOL_MAX: out_of_range'])
    expect(Object.keys(record).sort()).toEqual(['err', 'level', 'msg', 'time'])
    for (const forbidden of ['p@ss', 'p%40ss', 'busway_app', '127.0.0.1', 'postgres://', 'Invalid configuration', 'must be', '"stack"', '"message"', '"cause"']) {
      expect(sink.text(), forbidden).not.toContain(forbidden)
    }
  })

  it('the same holds for PGREPLICATION and never prints the variable value', () => {
    const sink = capture()
    const log = createSafeLogger({ logLevel: 'info' }, sink.stream)
    let error
    try { assertSafeDriverEnvironment({ PGREPLICATION: 'fixture-value-m34' }) } catch (e) { error = e }
    logSafeException(log, error, 'configuration_invalid')
    expect(sink.records()[0].err).toEqual({ type: 'UnknownError', code: 'CONFIG_ERROR', problems: ['PGREPLICATION: unsafe_driver_env'] })
    expect(sink.text()).not.toContain('fixture-value-m34')
  })

  it('an error that is not a configuration error keeps the previous safe fallback', () => {
    const sink = capture()
    const log = createSafeLogger({ logLevel: 'info' }, sink.stream)
    logSafeException(log, Object.assign(new TypeError(PW), { diagnostics: [{ variable: 'DATABASE_URL', reason: 'host' }] }), 'startup_failed')
    expect(sink.records()[0]).toMatchObject({ msg: 'failed to start', err: { type: 'TypeError', code: 'UNKNOWN_ERROR' } })
    expect(sink.records()[0].err.problems).toBeUndefined()
    expect(sink.text()).not.toContain(PW)
  })

  it('arbitrary text smuggled into a raw log record is removed by the final line filter', () => {
    const line = JSON.stringify({
      level: 50, time: 1, msg: PW,
      err: { type: 'Error', code: 'CONFIG_ERROR', problems: [`DATABASE_URL: ${PW}`, 'DATABASE_URL: host', 'PGOPTIONS: host', PW] },
    })
    const record = JSON.parse(sanitizeLogLine(line))
    expect(record.err.problems).toEqual(['DATABASE_URL: host'])
    expect(JSON.stringify(record)).not.toContain(PW)
    expect(record.msg).toBe('diagnostic event')
  })

  it('does not change request id handling: no identifiers appear without a server context', () => {
    const sink = capture()
    const log = createSafeLogger({ logLevel: 'info' }, sink.stream)
    logSafeException(log, failure({}), 'configuration_invalid')
    expect(sink.records()[0].request_id).toBeUndefined()
    expect(sink.records()[0].correlation_id).toBeUndefined()
  })
})

describe('the real server entry point (child process, stops before listening)', () => {
  const cwd = fileURLToPath(new URL('../..', import.meta.url))
  const run = (env) => {
    const result = spawnSync(process.execPath, ['src/server.js'], {
      cwd, encoding: 'utf8', timeout: 20_000,
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env },
    })
    return { status: result.status, stderr: result.stderr, text: `${result.stdout}${result.stderr}`, records: result.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) }
  }

  it.each([
    ['test database as working database', { DATABASE_URL: url({ db: 'busway_test' }) }, ['DATABASE_URL: test_database']],
    ['wrong host', { DATABASE_URL: url({ host: '192.0.2.1' }) }, ['DATABASE_URL: host']],
    ['pool size', { DATABASE_URL: GOOD, DB_POOL_MAX: '99' }, ['DB_POOL_MAX: out_of_range']],
    ['production', { DATABASE_URL: GOOD, NODE_ENV: 'production' }, ['NODE_ENV: no_production_profile']],
    ['missing', {}, ['DATABASE_URL: missing']],
    ['PGREPLICATION', { DATABASE_URL: GOOD, PGREPLICATION: 'database' }, ['PGREPLICATION: unsafe_driver_env']],
  ])('%s', (_name, env, expected) => {
    const result = run(env)
    expect(result.status).toBe(1)
    expect(result.stderr).toBe('')
    const record = result.records.at(-1)
    expect(record.msg).toBe('invalid configuration')
    expect(record.err).toEqual({ type: 'UnknownError', code: 'CONFIG_ERROR', problems: expected })
    for (const secret of [PW, '192.0.2.1', 'busway_app', 'postgres://']) {
      expect(result.text, secret).not.toContain(secret)
    }
  })
})
