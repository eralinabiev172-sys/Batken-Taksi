import { withVerifiedTestClients, TestDatabaseSafetyError } from '../../scripts/test-database-safety.js'
import { runTestMigrations } from '../../scripts/test-migrations.js'

/** Runs scripts/migrate.js against the scratch test database (never the dev database). */
export async function migrate(...args) {
  return runTestMigrations(args, process.env)
}

export async function withClient(envName, fn) {
  if (!['TEST_DATABASE_URL', 'TEST_MIGRATOR_DATABASE_URL'].includes(envName)) throw new TestDatabaseSafetyError()
  return withVerifiedTestClients(process.env, (clients) => fn(clients[envName]))
}

/** Resolves with the error thrown by `promise`, or fails if it did not throw. */
export async function expectDbError(promise) {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('Expected the statement to fail, but it succeeded')
}
