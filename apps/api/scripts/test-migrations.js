import { fileURLToPath } from 'node:url'
import { withVerifiedTestClients, TestDatabaseSafetyError } from './test-database-safety.js'

/** No CLI/config overrides: only these two operations on the verified test client. */
export async function runTestMigrations(args, env, { createClient, runner } = {}) {
  if (args.length !== 1 || !['up', 'down'].includes(args[0])) throw new TestDatabaseSafetyError()
  return withVerifiedTestClients(env, async (clients) => {
    const run = runner ?? (await import('node-pg-migrate')).runner
    const messages = []
    const record = (message) => messages.push(String(message))
    await run({
      dbClient: clients.TEST_MIGRATOR_DATABASE_URL,
      dir: fileURLToPath(new URL('../../../migrations', import.meta.url)),
      direction: args[0],
      migrationsTable: 'pgmigrations',
      schema: 'public',
      useGlob: false,
      checkOrder: true,
      singleTransaction: true,
      noLock: false,
      count: args[0] === 'down' ? 1 : Infinity,
      logger: { info: record, warn: record, error: record, debug() {} },
    })
    return { status: 0, output: messages.join('\n') }
  }, createClient)
}
