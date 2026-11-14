// Thin wrapper over node-pg-migrate (D-103).
// Usage: npm run migrate -- up | down [count] | redo
// MIGRATE_TARGET=test applies the migrations to the scratch test database.
// Connects as busway_migrator (DDL rights), never as the application role.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runTestMigrations } from './test-migrations.js'
import { migrationDiagnostic } from '../src/lib/safe-diagnostics.js'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../../..')

const envFile = join(repoRoot, '.env')
try {
  if (existsSync(envFile)) process.loadEnvFile(envFile)
} catch (error) {
  console.error(JSON.stringify(migrationDiagnostic('configuration', { error })))
  process.exit(1)
}

// Test migrations never delegate to the CLI: URL/config flags must not bypass
// preflight or reconnect after checking the actual database identity.
if (process.env.MIGRATE_TARGET === 'test') {
  try {
    const result = await runTestMigrations(process.argv.slice(2), process.env)
    console.log(result.status === 0 ? 'Test migrations completed' : 'Test migrations failed')
    process.exit(0)
  } catch (error) {
    console.error(JSON.stringify(migrationDiagnostic('test_migration', { error })))
    process.exit(1)
  }
}
if (process.env.MIGRATE_TARGET && process.env.MIGRATE_TARGET !== 'development') {
  console.error('Unknown MIGRATE_TARGET; no migration performed')
  process.exit(1)
}

const target = process.env.MIGRATE_TARGET === 'test' ? 'TEST_MIGRATOR_DATABASE_URL' : 'MIGRATOR_DATABASE_URL'
const url = process.env[target]
if (!url) {
  console.error(`${target} is not set (see .env.example)`)
  process.exit(1)
}

function findCli() {
  for (let dir = here; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', 'node-pg-migrate', 'bin', 'node-pg-migrate.js')
    if (existsSync(candidate)) return candidate
    if (dirname(dir) === dir) throw new Error('node-pg-migrate is not installed')
  }
}

const args = process.argv.slice(2)
let result
try {
  result = spawnSync(
    process.execPath,
    [findCli(), ...args, '--migrations-dir', join(repoRoot, 'migrations'), '--migration-filename-format', 'index'],
    // Never echo raw stdout/stderr, SQL, stacks or connection strings.
    { stdio: 'ignore', env: { ...process.env, DATABASE_URL: url } },
  )
} catch (error) {
  console.error(JSON.stringify(migrationDiagnostic('cli_spawn', { error })))
  process.exit(1)
}
if (result.status === 0) console.log(JSON.stringify(migrationDiagnostic('cli_exit', result)))
else console.error(JSON.stringify(migrationDiagnostic(result.error ? 'cli_spawn' : 'cli_exit', result)))
process.exit(result.status ?? 1)
