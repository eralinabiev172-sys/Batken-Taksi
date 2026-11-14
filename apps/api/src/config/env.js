import Type from 'typebox'
import Value from 'typebox/value'
import { createDiagnostics } from '../lib/config-diagnostics.js'

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost'])

/**
 * Connection budget of the local PostgreSQL service (docker-compose.yml: max_connections=30).
 * PostgreSQL keeps superuser_reserved_connections (default 3) for superusers only, so
 * ordinary roles share 27 slots. The application pool is deliberately small:
 * one API process, a 3-bus MVP (~1.5 positions/s), and the rest is left for the
 * migrator, tests on busway_test, admin sessions and a future second pool.
 * A static test keeps these numbers consistent with docker-compose.yml.
 */
export const DB_MAX_CONNECTIONS = 30
export const DB_SUPERUSER_RESERVED = 3
export const DB_POOL_MAX_LIMIT = 10
export const DB_POOL_MAX_DEFAULT = 5

/**
 * The only approved database profile (D-137): local PostgreSQL on loopback.
 * A production host/port/role needs a separate, explicitly approved profile;
 * until then nothing else is accepted.
 */
export const APPROVED_LOCAL_DATABASE = Object.freeze({
  protocols: Object.freeze(['postgres:', 'postgresql:']),
  host: '127.0.0.1',
  port: '5432',
  database: 'busway',
  user: 'busway_app',
})
const TEST_DATABASES = new Set(['busway_test'])

const EnvSchema = Type.Object({
  nodeEnv: Type.Union([
    Type.Literal('development'),
    Type.Literal('test'),
    Type.Literal('production'),
  ]),
  host: Type.String({ minLength: 1 }),
  port: Type.Integer({ minimum: 1, maximum: 65535 }),
  logLevel: Type.Union(LOG_LEVELS.map((level) => Type.Literal(level))),
  databaseUrl: Type.String({ minLength: 1 }),
  dbPoolMax: Type.Integer({ minimum: 1, maximum: DB_POOL_MAX_LIMIT }),
})

const ENV_NAMES = {
  nodeEnv: 'NODE_ENV',
  host: 'HOST',
  port: 'PORT',
  logLevel: 'LOG_LEVEL',
  databaseUrl: 'DATABASE_URL',
  dbPoolMax: 'DB_POOL_MAX',
}

/**
 * `problems` are fixed-text messages for developers; `diagnostics` is the logger-safe list of
 * {variable, reason} constants (see config-diagnostics.js). `code` is a stable safe code.
 */
export class ConfigError extends Error {
  constructor(problems, diagnostics = []) {
    super(`Invalid configuration: ${problems.join('; ')}`)
    this.name = 'ConfigError'
    this.code = 'CONFIG_ERROR'
    this.problems = problems
    this.diagnostics = createDiagnostics(diagnostics)
  }
}

/** DatabaseUrlError.reason (internal wording) -> fixed diagnostic reason code. */
const URL_REASON_CODES = Object.freeze({
  empty: 'empty',
  malformed: 'malformed',
  'unexpected parameters': 'unexpected_parameters',
  scheme: 'scheme',
  'host missing': 'host',
  host: 'host',
  'port missing': 'port',
  port: 'port',
  'database missing': 'database',
  database: 'database',
  'test database': 'test_database',
  'user missing': 'user',
  user: 'user',
  'password missing': 'password',
})

/** Carries only a fixed reason; never the URL, a component of it or a parser message. */
export class DatabaseUrlError extends Error {
  constructor(reason) {
    super(`DATABASE_URL is not an approved local database URL (${reason})`)
    this.name = 'DatabaseUrlError'
    this.reason = reason
  }
}

function toInteger(value) {
  if (value === undefined || value === '') return undefined
  return /^-?\d+$/.test(String(value)) ? Number(value) : value
}

/** Whitespace, control characters, DEL and backslash never belong in a connection URL. */
function hasForbiddenCharacter(value) {
  for (const char of value) {
    const code = char.codePointAt(0)
    if (code <= 0x20 || code === 0x7f || char === '\\' || /\s/.test(char)) return true
  }
  return false
}

/**
 * Strict parsing of the working database URL. Returns explicit pg options so the
 * driver never falls back to PGHOST/PGPORT/PGDATABASE/PGUSER or URL query parameters.
 * @param {unknown} value
 * @param {typeof APPROVED_LOCAL_DATABASE} [profile]
 */
export function parseDatabaseUrl(value, profile = APPROVED_LOCAL_DATABASE) {
  const fail = (reason) => { throw new DatabaseUrlError(reason) }
  if (typeof value !== 'string' || value.length === 0) fail('empty')
  if (hasForbiddenCharacter(value)) fail('malformed')
  if (/[?#]/.test(value)) fail('unexpected parameters')

  let url
  try { url = new URL(value) } catch { fail('malformed') }

  if (!profile.protocols.includes(url.protocol)) fail('scheme')
  if (url.hostname === '') fail('host missing')
  if (url.hostname !== profile.host) fail('host')
  if (url.port === '') fail('port missing')
  if (url.port !== profile.port) fail('port')

  const segments = url.pathname.split('/')
  if (url.pathname === '' || url.pathname === '/') fail('database missing')
  if (segments.length !== 2) fail('database')
  let database, user, password
  try {
    database = decodeURIComponent(segments[1])
    user = decodeURIComponent(url.username)
    password = decodeURIComponent(url.password)
  } catch { fail('malformed') }
  if (TEST_DATABASES.has(database)) fail('test database')
  if (database !== profile.database) fail('database')
  if (user === '') fail('user missing')
  if (user !== profile.user) fail('user')
  if (password === '') fail('password missing')

  return Object.freeze({
    host: profile.host,
    port: Number(profile.port),
    database,
    user,
    password,
    ssl: false,
  })
}

/**
 * Reads and validates configuration. Fails fast. Error messages name variables
 * and fixed reasons only and never echo values (the database URL contains a password).
 * @param {Record<string, string | undefined>} [env]
 */
export function loadConfig(env = process.env) {
  const raw = {
    nodeEnv: env.NODE_ENV || 'development',
    host: env.HOST || '127.0.0.1',
    port: toInteger(env.PORT) ?? 3001,
    logLevel: env.LOG_LEVEL || 'info',
    databaseUrl: env.DATABASE_URL,
    dbPoolMax: toInteger(env.DB_POOL_MAX) ?? DB_POOL_MAX_DEFAULT,
  }

  const problems = []
  const diagnostics = []
  // Every refusal records a fixed message AND a fixed {variable, reason}; neither holds a value.
  const report = (variable, reason, message) => {
    problems.push(message)
    diagnostics.push({ variable, reason })
  }
  if (raw.databaseUrl === undefined) report('DATABASE_URL', 'missing', 'DATABASE_URL is required')

  if (raw.databaseUrl !== undefined || problems.length === 0) {
    for (const error of Value.Errors(EnvSchema, raw)) {
      const key = String(error.instancePath ?? '').replace(/^\//, '')
      const name = ENV_NAMES[key] ?? key
      if (!name) continue
      // A well-formed integer that violates min/max is a range problem; anything else is invalid.
      const reason = key === 'databaseUrl' && raw.databaseUrl === ''
        ? 'empty'
        : (key === 'port' || key === 'dbPoolMax') && typeof raw[key] === 'number' ? 'out_of_range' : 'invalid'
      report(name, reason, `${name} ${error.message}`)
    }
  }

  if (raw.databaseUrl !== undefined && !problems.some((p) => p.startsWith('DATABASE_URL'))) {
    try {
      parseDatabaseUrl(raw.databaseUrl)
    } catch (error) {
      if (error instanceof DatabaseUrlError) {
        report('DATABASE_URL', URL_REASON_CODES[error.reason] ?? 'invalid', error.message)
      } else {
        report('DATABASE_URL', 'malformed', 'DATABASE_URL is not an approved local database URL (malformed)')
      }
    }
    // The working connection must be a separate setting from migration/test connections.
    for (const other of ['MIGRATOR_DATABASE_URL', 'TEST_DATABASE_URL', 'TEST_MIGRATOR_DATABASE_URL']) {
      if (env[other] !== undefined && env[other] === raw.databaseUrl) {
        report('DATABASE_URL', 'same_connection', `DATABASE_URL must not be the same connection as ${other}`)
      }
    }
    if (raw.nodeEnv === 'production') {
      report('NODE_ENV', 'no_production_profile', 'DATABASE_URL has no approved production database profile yet')
    }
  }

  if (problems.length === 0 && !LOOPBACK_HOSTS.has(raw.host) && env.ALLOW_NON_LOOPBACK_HOST !== 'true') {
    report('HOST', 'non_loopback', 'HOST must be a loopback address unless ALLOW_NON_LOOPBACK_HOST=true')
  }

  if (problems.length > 0) throw new ConfigError([...new Set(problems)], diagnostics)
  return Object.freeze(raw)
}
