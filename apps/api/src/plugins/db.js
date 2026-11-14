import pg from 'pg'
import { logSafeException } from '../lib/safe-diagnostics.js'
import { createDiagnostics } from '../lib/config-diagnostics.js'

/**
 * How pg 8.x treats the environment (verified in node_modules/pg/lib/connection-parameters.js):
 * an explicit option wins over PG* ONLY when it is truthy; '' and false are treated as
 * "not set" and fall back to the environment. Therefore every value below is a non-empty
 * constant. Not neutralisable this way: PGREPLICATION (see UNSAFE_DRIVER_ENV).
 * PGBINARY is read into connectionParameters but never used by Client in pg 8.23.1
 * (Client.binary comes from the client config), so it has no effect; a test pins that.
 */
export const POOL_APPLICATION_NAME = 'busway-api'
// Same string as the HIGH test guard. Startup `options` are applied AFTER individual
// startup parameters, so an inherited PGOPTIONS could otherwise override statement_timeout.
export const POOL_SESSION_OPTIONS = '-c statement_timeout=15000'
const STATEMENT_TIMEOUT_MS = 15_000

/** Variables that pg would silently honour and that explicit settings cannot neutralise. */
export const UNSAFE_DRIVER_ENV = Object.freeze(['PGREPLICATION'])

/** Names only, never values. `code` lets the safe logger keep a stable diagnostic code. */
export class DriverEnvironmentError extends Error {
  constructor(names) {
    super(`Unsafe PostgreSQL driver environment variable(s) set: ${names.join(', ')}`)
    this.name = 'DriverEnvironmentError'
    this.code = 'CONFIG_ERROR'
    this.names = names
    this.diagnostics = createDiagnostics(names.map((variable) => ({ variable, reason: 'unsafe_driver_env' })))
  }
}

/** Fails closed instead of letting the environment change result format or session type. */
export function assertSafeDriverEnvironment(env = process.env) {
  const names = UNSAFE_DRIVER_ENV.filter((name) => env[name])
  if (names.length > 0) throw new DriverEnvironmentError(names)
}

/**
 * Explicit driver options. No connectionString is passed, so URL query parameters cannot
 * redirect the connection; host/port/database/user/password/ssl and the session settings
 * below are all non-empty explicit values, so PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD/
 * PGSSLMODE/PGOPTIONS/PGAPPNAME/PGSSLNEGOTIATION/PGCLIENT_ENCODING do not apply.
 * PGCONNECT_TIMEOUT is not read because connectionTimeoutMillis is set.
 * Approval of host/port/database/role is enforced by loadConfig.
 * @param {{ databaseUrl: string, dbPoolMax: number }} config
 */
export function poolOptions(config) {
  const url = new URL(config.databaseUrl)
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 5432,
    database: decodeURIComponent(url.pathname.replace(/^\//, '')),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ssl: false,
    sslnegotiation: 'postgres',
    client_encoding: 'utf8',
    application_name: POOL_APPLICATION_NAME,
    options: POOL_SESSION_OPTIONS,
    max: config.dbPoolMax,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: STATEMENT_TIMEOUT_MS,
  }
}

/** @param {{ databaseUrl: string, dbPoolMax: number }} config */
export function createPool(config) {
  assertSafeDriverEnvironment()
  return new pg.Pool(poolOptions(config))
}

/**
 * Decorates the app with `db` (a pg Pool). All queries must be parameterized:
 * `app.db.query('select ... where id = $1', [id])`.
 * A pool passed in by the caller is not closed by the app.
 */
export function registerDb(app, pool, { owned }) {
  pool.on('error', (error) => logSafeException(app.log, error, 'database_pool_error'))
  app.decorate('db', pool)
  if (owned) app.addHook('onClose', async () => pool.end())
}
