import pg from 'pg'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  TestDatabaseSafetyError,
  validateTestTargets,
  withVerifiedTestClients,
} from '../../scripts/test-database-safety.js'
import { runTestMigrations } from '../../scripts/test-migrations.js'

// Synthetic fixtures only. No environment loaded by setup.js is used here.
const env = () => ({
  BUSWAY_ALLOW_DESTRUCTIVE_TESTS: 'busway_test',
  DATABASE_URL: 'postgres://busway_app:fixture@127.0.0.1:5432/busway',
  MIGRATOR_DATABASE_URL: 'postgres://busway_migrator:fixture@127.0.0.1:5432/busway',
  TEST_DATABASE_URL: 'postgres://busway_app:fixture@127.0.0.1:5432/busway_test',
  TEST_MIGRATOR_DATABASE_URL: 'postgres://busway_migrator:fixture@127.0.0.1:5432/busway_test',
})

// A regression cannot accidentally open a real connection during these unit tests.
beforeEach(() => {
  vi.spyOn(pg.Client.prototype, 'connect').mockImplementation(() => {
    throw new Error('Real PostgreSQL connections are forbidden in unit tests')
  })
})
afterEach(() => vi.restoreAllMocks())

function fakeDatabase(overrides = {}) {
  const clients = []
  const createClient = vi.fn((options) => {
    const identity = {
      database_name: 'busway_test', role_name: options.user, session_role: options.user,
      server_address: '172.20.0.2', server_port: 5432, is_superuser: 'off',
      ...overrides[options.user],
    }
    const client = {
      options,
      connect: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue({ rows: [identity] }),
      end: vi.fn().mockResolvedValue(undefined),
    }
    clients.push(client)
    return client
  })
  return { createClient, clients }
}

describe('pure URL/permission preflight', () => {
  it('accepts only the explicit local test target and expected roles', () => {
    const targets = validateTestTargets(env())
    expect(targets.TEST_DATABASE_URL).toMatchObject({
      host: '127.0.0.1', port: 5432, database: 'busway_test', user: 'busway_app',
      options: '-c statement_timeout=15000', ssl: false,
    })
    expect(targets.TEST_MIGRATOR_DATABASE_URL.user).toBe('busway_migrator')
  })

  it.each([undefined, '', 'true', '1', 'busway'])('refuses missing/incorrect opt-in (%s)', (value) => {
    expect(() => validateTestTargets({ ...env(), BUSWAY_ALLOW_DESTRUCTIVE_TESTS: value })).toThrow(TestDatabaseSafetyError)
  })

  it.each(['DATABASE_URL', 'MIGRATOR_DATABASE_URL', 'TEST_DATABASE_URL', 'TEST_MIGRATOR_DATABASE_URL'])(
    'requires %s before any connection', async (key) => {
      const createClient = vi.fn()
      await expect(withVerifiedTestClients({ ...env(), [key]: undefined }, vi.fn(), createClient)).rejects.toThrow(TestDatabaseSafetyError)
      expect(createClient).not.toHaveBeenCalled()
    },
  )

  it.each([
    ['working database', 'postgres://busway_migrator:fixture@127.0.0.1:5432/busway'],
    ['another database', 'postgres://busway_migrator:fixture@127.0.0.1:5432/unrelated_db'],
    ['different port', 'postgres://busway_migrator:fixture@127.0.0.1:55432/busway_test'],
    ['remote host', 'postgres://busway_migrator:fixture@192.0.2.1:5432/busway_test'],
    ['ambiguous hostname', 'postgres://busway_migrator:fixture@localhost:5432/busway_test'],
    ['superuser', 'postgres://postgres:fixture@127.0.0.1:5432/busway_test'],
    ['swapped roles', 'postgres://busway_app:fixture@127.0.0.1:5432/busway_test'],
    ['query override', 'postgres://busway_migrator:fixture@127.0.0.1:5432/busway_test?host=192.0.2.1'],
    ['session override', 'postgres://busway_migrator:fixture@127.0.0.1:5432/busway_test?options=-crole=postgres'],
    ['fragment', 'postgres://busway_migrator:fixture@127.0.0.1:5432/busway_test#x'],
    ['missing password', 'postgres://busway_migrator@127.0.0.1:5432/busway_test'],
    ['missing port', 'postgres://busway_migrator:fixture@127.0.0.1/busway_test'],
    ['malformed URL', 'postgres://'],
  ])('rejects %s before creating a client or running a migration', async (_reason, url) => {
    const createClient = vi.fn()
    const runner = vi.fn()
    await expect(runTestMigrations(['down'], { ...env(), TEST_MIGRATOR_DATABASE_URL: url }, { createClient, runner })).rejects.toThrow(TestDatabaseSafetyError)
    expect(createClient).not.toHaveBeenCalled()
    expect(runner).not.toHaveBeenCalled()
  })

  it('refuses an app connection to the working DB even when the migrator targets test', async () => {
    const createClient = vi.fn()
    await expect(withVerifiedTestClients({ ...env(), TEST_DATABASE_URL: env().DATABASE_URL }, vi.fn(), createClient)).rejects.toThrow(TestDatabaseSafetyError)
    expect(createClient).not.toHaveBeenCalled()
  })

  it('refuses mismatched working connection endpoints too', () => {
    expect(() => validateTestTargets({ ...env(), MIGRATOR_DATABASE_URL: env().MIGRATOR_DATABASE_URL.replace(':5432/', ':55432/') })).toThrow(TestDatabaseSafetyError)
  })
})

describe('actual server identity checks (fake clients, SELECT only)', () => {
  it.each([
    { database_name: 'busway' },
    { database_name: 'unrelated_db' },
    { role_name: 'postgres' },
    { session_role: 'postgres' },
    { server_port: 55432 },
    { server_address: null },
    { is_superuser: 'on' },
  ])('refuses an unconfirmed actual target %j', async (actual) => {
    const fake = fakeDatabase({ busway_migrator: actual })
    const runner = vi.fn()
    await expect(runTestMigrations(['down'], env(), { ...fake, runner })).rejects.toThrow(TestDatabaseSafetyError)
    expect(runner).not.toHaveBeenCalled()
    for (const client of fake.clients) {
      expect(client.end).toHaveBeenCalledOnce()
      expect(client.query).toHaveBeenCalledTimes(1)
      expect(client.query.mock.calls[0][0]).toMatch(/^select /)
    }
  })

  it('checks the app role before admitting the migrator', async () => {
    const fake = fakeDatabase({ busway_app: { database_name: 'busway' } })
    const operation = vi.fn()
    await expect(withVerifiedTestClients(env(), operation, fake.createClient)).rejects.toThrow(TestDatabaseSafetyError)
    expect(operation).not.toHaveBeenCalled()
    expect(fake.createClient).toHaveBeenCalledTimes(1)
  })

  it('requires both users to reach the same server', async () => {
    const fake = fakeDatabase({ busway_migrator: { server_address: '172.20.0.3' } })
    const runner = vi.fn()
    await expect(runTestMigrations(['down'], env(), { ...fake, runner })).rejects.toThrow(TestDatabaseSafetyError)
    expect(runner).not.toHaveBeenCalled()
  })

  it('treats a failed identity read as uncertainty; hides errors and closes clients', async () => {
    const fake = fakeDatabase()
    const createClient = (options) => {
      const client = fake.createClient(options)
      client.query.mockRejectedValue(new Error('fixture-password-in-database-error'))
      return client
    }
    const operation = vi.fn()
    await expect(withVerifiedTestClients(env(), operation, createClient)).rejects.toThrow('Test database safety check failed')
    expect(operation).not.toHaveBeenCalled()
    expect(fake.clients[0].end).toHaveBeenCalledOnce()
  })

  it('rejects empty identity results', async () => {
    const fake = fakeDatabase()
    const createClient = (options) => {
      const client = fake.createClient(options)
      client.query.mockResolvedValue({ rows: [] })
      return client
    }
    await expect(withVerifiedTestClients(env(), vi.fn(), createClient)).rejects.toThrow(TestDatabaseSafetyError)
  })
})

describe('migration admission (no actual migration runner is invoked)', () => {
  it('never admits down without explicit permission, even with valid URLs', async () => {
    const createClient = vi.fn()
    const runner = vi.fn()
    await expect(runTestMigrations(['down'], { ...env(), BUSWAY_ALLOW_DESTRUCTIVE_TESTS: undefined }, { createClient, runner })).rejects.toThrow(TestDatabaseSafetyError)
    expect(createClient).not.toHaveBeenCalled()
    expect(runner).not.toHaveBeenCalled()
  })

  it('does not run a migration when connecting to either role fails', async () => {
    const fake = fakeDatabase()
    const createClient = (options) => {
      const client = fake.createClient(options)
      if (options.user === 'busway_migrator') client.connect.mockRejectedValue(new Error('synthetic connection failure'))
      return client
    }
    const runner = vi.fn()
    await expect(runTestMigrations(['down'], env(), { createClient, runner })).rejects.toThrow(TestDatabaseSafetyError)
    expect(runner).not.toHaveBeenCalled()
    for (const client of fake.clients) expect(client.end).toHaveBeenCalledOnce()
  })

  it.each([[], ['redo'], ['down', '2'], ['down', '--database-url', 'postgres://x'], ['up', '--config-file', 'x']])(
    'refuses unapproved commands/override arguments %j', async (...parts) => {
      // Vitest spreads array table entries into arguments.
      const args = parts.filter((part) => typeof part === 'string')
      const runner = vi.fn()
      const createClient = vi.fn()
      await expect(runTestMigrations(args, env(), { createClient, runner })).rejects.toThrow(TestDatabaseSafetyError)
      expect(createClient).not.toHaveBeenCalled()
      expect(runner).not.toHaveBeenCalled()
    },
  )

  it.each(['up', 'down'])('runs %s only on the same verified migrator client', async (direction) => {
    const fake = fakeDatabase()
    const runner = vi.fn(async (options) => {
      for (const client of fake.clients) expect(client.query).toHaveBeenCalledTimes(1)
      expect(options.dbClient).toBe(fake.clients[1])
      expect(options.databaseUrl).toBeUndefined()
      expect(options.useGlob).toBe(false)
      expect(options.noLock).toBe(false)
      expect(options.direction).toBe(direction)
      expect(options.dir).toMatch(/migrations[\\/]?$/)
      options.logger.info('No migrations to run!')
    })
    const result = await runTestMigrations([direction], env(), { ...fake, runner })
    expect(result.status).toBe(0)
    expect(result.output).toMatch(/No migrations/)
    expect(runner).toHaveBeenCalledOnce()
    for (const client of fake.clients) expect(client.end).toHaveBeenCalledOnce()
    expect(pg.Client.prototype.connect).not.toHaveBeenCalled()
  })
})
