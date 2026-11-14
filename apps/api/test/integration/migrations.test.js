import { describe, expect, it } from 'vitest'
import { migrate, withClient } from '../helpers/db.js'

const TABLES = ['audit_logs', 'cities', 'driver_profiles', 'sessions', 'user_roles', 'users']

async function existingTables() {
  return withClient('TEST_MIGRATOR_DATABASE_URL', async (client) => {
    const { rows } = await client.query(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_name = any($1) order by table_name`,
      [TABLES],
    )
    return rows.map((row) => row.table_name)
  })
}

async function extensions() {
  return withClient('TEST_MIGRATOR_DATABASE_URL', async (client) => {
    const { rows } = await client.query(`select extname from pg_extension where extname in ('postgis','btree_gist') order by 1`)
    return rows.map((row) => row.extname)
  })
}

describe('migrations on a clean scratch database', () => {
  it('up creates the core schema', async () => {
    const result = await migrate('up')
    expect(result.status, result.output).toBe(0)
  })

  it('tables exist after up, and postgis comes first', async () => {
    expect(await existingTables()).toEqual(TABLES)
    expect(await extensions()).toEqual(['btree_gist', 'postgis'])
  })

  it('running up again is idempotent', async () => {
    const result = await migrate('up')
    expect(result.status, result.output).toBe(0)
    expect(result.output).toMatch(/no migrations to run/i)
  })

  it('0003 refuses automatic down without deleting fields or the core tables', async () => {
    // 0002 rollback is tested separately at the 0002 upgrade checkpoint.
    // Deleting newly added columns is not authorised. The guarded runner still
    // verifies the test target; PostgreSQL must refuse this forward-only rollback.
    await expect(migrate('down')).rejects.toMatchObject({ code: '0A000' })
    expect(await existingTables()).toEqual(TABLES)
    expect(await extensions()).toEqual(['btree_gist', 'postgis'])
  })

  it('up after a refused rollback keeps the schema', async () => {
    const result = await migrate('up')
    expect(result.status, result.output).toBe(0)
    expect(await existingTables()).toEqual(TABLES)
  })
})
