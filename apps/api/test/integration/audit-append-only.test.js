import { beforeAll, describe, expect, it } from 'vitest'
import { expectDbError, migrate, withClient } from '../helpers/db.js'

beforeAll(async () => {
  const result = await migrate('up')
  if (result.status !== 0) throw new Error(`migrations failed: ${result.output}`)
})

const insertAudit = (client, action) =>
  client.query(`insert into audit_logs (action, details) values ($1, '{}') returning id`, [action])

describe('audit_logs is append-only', () => {
  it('the application role can append and read', async () => {
    await withClient('TEST_DATABASE_URL', async (client) => {
      const { rows } = await insertAudit(client, 'test.append')
      expect(rows).toHaveLength(1)
      const read = await client.query('select action from audit_logs where id = $1', [rows[0].id])
      expect(read.rows[0].action).toBe('test.append')
    })
  })

  it('the application role has no UPDATE, DELETE or TRUNCATE privilege', async () => {
    await withClient('TEST_DATABASE_URL', async (client) => {
      const { rows } = await insertAudit(client, 'test.privileges')
      const id = rows[0].id
      expect((await expectDbError(client.query(`update audit_logs set action = 'x' where id = $1`, [id]))).code).toBe('42501')
      expect((await expectDbError(client.query('delete from audit_logs where id = $1', [id]))).code).toBe('42501')
      expect((await expectDbError(client.query('truncate audit_logs'))).code).toBe('42501')
    })
  })

  it('even the table owner is stopped by the trigger', async () => {
    await withClient('TEST_MIGRATOR_DATABASE_URL', async (client) => {
      const { rows } = await insertAudit(client, 'test.owner')
      const id = rows[0].id
      for (const run of [
        () => client.query(`update audit_logs set action = 'x' where id = $1`, [id]),
        () => client.query('delete from audit_logs where id = $1', [id]),
        () => client.query('truncate audit_logs'),
      ]) {
        const error = await expectDbError(run())
        expect(error.code).toBe('23000')
        expect(error.message).toMatch(/append-only/)
      }
      const still = await client.query('select count(*)::int as n from audit_logs where id = $1', [id])
      expect(still.rows[0].n).toBe(1)
    })
  })

  it('the application role cannot change the schema', async () => {
    await withClient('TEST_DATABASE_URL', async (client) => {
      expect((await expectDbError(client.query('create table app_owned_table (id int)'))).code).toBe('42501')
      expect((await expectDbError(client.query('drop table audit_logs'))).code).toBe('42501')
    })
  })
})
