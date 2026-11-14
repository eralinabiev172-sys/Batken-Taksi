import { beforeAll, describe, expect, it } from 'vitest'
import { expectDbError, migrate, withClient } from '../helpers/db.js'

beforeAll(async () => {
  const result = await migrate('up')
  if (result.status !== 0) throw new Error(`migrations failed: ${result.output}`)
})

const PUB = (letter) => `usr_${letter.repeat(22)}`

// Each case runs in a transaction that is always rolled back, so no data is left behind.
async function inRollback(fn) {
  await withClient('TEST_MIGRATOR_DATABASE_URL', async (client) => {
    await client.query('begin')
    try {
      await fn(client)
    } finally {
      await client.query('rollback')
    }
  })
}

async function violates(client, sql, params) {
  await client.query('savepoint s')
  const error = await expectDbError(client.query(sql, params))
  await client.query('rollback to savepoint s')
  return error.code
}

describe('schema constraints', () => {
  it('rejects a malformed public id (cities, users)', async () => {
    await inRollback(async (client) => {
      expect(await violates(client, `insert into cities (public_id, name_ru, name_ky) values ('3f2504e0', 'a', 'b')`)).toBe('23514')
      expect(await violates(client, `insert into users (public_id, email, password_hash) values ('bad', 'a@example.test', 'h')`)).toBe('23514')
    })
  })

  it('email is unique case-insensitively', async () => {
    await inRollback(async (client) => {
      await client.query(`insert into users (public_id, email, password_hash) values ($1, 'Case@Example.test', 'h')`, [PUB('a')])
      expect(await violates(client, `insert into users (public_id, email, password_hash) values ($1, 'case@example.TEST', 'h')`, [PUB('b')])).toBe('23505')
    })
  })

  it('roles are limited to admin and driver', async () => {
    await inRollback(async (client) => {
      const { rows } = await client.query(`insert into users (public_id, email, password_hash) values ($1, 'r@example.test', 'h') returning id`, [PUB('c')])
      await client.query(`insert into user_roles (user_id, role) values ($1, 'driver')`, [rows[0].id])
      expect(await violates(client, `insert into user_roles (user_id, role) values ($1, 'passenger')`, [rows[0].id])).toBe('23514')
    })
  })

  it('stores only a 32-byte session token hash and requires a future expiry', async () => {
    await inRollback(async (client) => {
      const { rows } = await client.query(`insert into users (public_id, email, password_hash) values ($1, 's@example.test', 'h') returning id`, [PUB('d')])
      const userId = rows[0].id
      expect(await violates(client, `insert into sessions (user_id, token_hash, absolute_expires_at, idle_expires_at) values ($1, '\\x00'::bytea, now() + interval '1 hour', now() + interval '1 hour')`, [userId])).toBe('23514')
      const hash = '\\x' + '00'.repeat(32)
      expect(await violates(client, `insert into sessions (user_id, token_hash, absolute_expires_at, idle_expires_at) values ($1, $2::bytea, now() - interval '1 hour', now() + interval '1 hour')`, [userId, hash])).toBe('23514')
      await client.query(`insert into sessions (user_id, token_hash, absolute_expires_at, idle_expires_at) values ($1, $2::bytea, now() + interval '1 hour', now() + interval '30 minutes')`, [userId, hash])
    })
  })

  it('the application role cannot delete users', async () => {
    await withClient('TEST_DATABASE_URL', async (client) => {
      const error = await expectDbError(client.query('delete from users'))
      expect(error.code).toBe('42501')
    })
  })
})
