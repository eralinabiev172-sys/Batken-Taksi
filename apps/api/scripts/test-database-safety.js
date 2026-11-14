import pg from 'pg'

const TEST_DB = 'busway_test'
const ROLES = { TEST_DATABASE_URL: 'busway_app', TEST_MIGRATOR_DATABASE_URL: 'busway_migrator' }

export class TestDatabaseSafetyError extends Error {
  constructor() {
    // Never include a URL, submitted value, database error or password.
    super('Test database safety check failed; no test operations are permitted')
    this.name = 'TestDatabaseSafetyError'
  }
}

function requireSafe(condition) {
  if (!condition) throw new TestDatabaseSafetyError()
}

const ISOLATED_TEST_PORT = '55433'
function parseTarget(value, database, user, env = process.env) {
  try {
    const url = new URL(value)
    requireSafe(['postgres:', 'postgresql:'].includes(url.protocol))
    const allowedPorts = ['5432']
    if (env.BUSWAY_ALLOW_ISOLATED_TESTS === '1') allowedPorts.push(ISOLATED_TEST_PORT)
    requireSafe(url.hostname === '127.0.0.1' && allowedPorts.includes(url.port))
    requireSafe(url.pathname === `/${database}` && decodeURIComponent(url.username) === user)
    requireSafe(Boolean(url.password) && !url.search && !url.hash)
    // Explicit pg options do not inherit connection targets or session options
    // from PGHOST, PGPORT, PGDATABASE, PGUSER, PGOPTIONS or URL query parameters.
    return Object.freeze({
      host: '127.0.0.1', port: Number(url.port), database, user,
      password: decodeURIComponent(url.password),
      options: '-c statement_timeout=15000', ssl: false, connectionTimeoutMillis: 5000,
    })
  } catch {
    throw new TestDatabaseSafetyError()
  }
}

/** Pure preflight: all four URLs are required; no connection is made here. */
export function validateTestTargets(env) {
  // Not supplied by .env.example or automatically enabled by the test runner.
  // Set only in the shell for an explicitly authorised destructive test run.
  requireSafe(env.BUSWAY_ALLOW_DESTRUCTIVE_TESTS === 'busway_test')
  if (env.BUSWAY_ALLOW_ISOLATED_TESTS === '1') requireSafe(env.BUSWAY_ISOLATED_TEST_CONTAINER === 'busway-test-postgres-iso')
  parseTarget(env.DATABASE_URL, 'busway', 'busway_app', env)
  parseTarget(env.MIGRATOR_DATABASE_URL, 'busway', 'busway_migrator', env)
  const targets = {}
  for (const [key, role] of Object.entries(ROLES)) targets[key] = parseTarget(env[key], TEST_DB, role, env)
  return Object.freeze(targets)
}

const IDENTITY_SQL = `select current_database() as database_name,
  current_user as role_name, session_user as session_role,
  inet_server_addr()::text as server_address, inet_server_port() as server_port,
  current_setting('is_superuser') as is_superuser`

/**
 * Verify both actual connections using SELECT only, before allowing any test SQL.
 * The callback uses the SAME clients that passed verification (no reconnect).
 * createClient is injectable for offline unit tests, never selected through env.
 */
export async function withVerifiedTestClients(env, callback, createClient = (options) => new pg.Client(options)) {
  const targets = validateTestTargets(env)
  const clients = {}
  try {
    let serverAddress
    for (const [key, options] of Object.entries(targets)) {
      const client = createClient(options)
      clients[key] = client
      await client.connect()
      const { rows } = await client.query(IDENTITY_SQL)
      requireSafe(rows.length === 1)
      const actual = rows[0]
      requireSafe(actual.database_name === TEST_DB)
      requireSafe(actual.role_name === options.user && actual.session_role === options.user)
      requireSafe(actual.is_superuser === 'off' && actual.server_port === 5432)
      requireSafe(typeof actual.server_address === 'string' && actual.server_address.length > 0)
      if (serverAddress !== undefined) requireSafe(serverAddress === actual.server_address)
      serverAddress = actual.server_address
    }
  } catch {
    await Promise.allSettled(Object.values(clients).map((client) => client.end()))
    throw new TestDatabaseSafetyError()
  }
  try {
    return await callback(clients)
  } finally {
    await Promise.allSettled(Object.values(clients).map((client) => client.end()))
  }
}
