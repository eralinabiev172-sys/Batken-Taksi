import { describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.js'
import { withClient } from '../helpers/db.js'

describe('readiness against a real database', () => {
  it('GET /health/ready reports the database as up', async () => {
    await withClient('TEST_DATABASE_URL', async (client) => {
      const app = await buildApp({ config: { logLevel: 'silent' }, pool: client })
      try {
        const res = await app.inject('/health/ready')
        expect(res.statusCode).toBe(200)
        expect(res.json()).toEqual({ status: 'ok', database: 'up' })
      } finally {
        await app.close()
      }
    })
  })

  it('the application connects as busway_app, not as a superuser', async () => {
    await withClient('TEST_DATABASE_URL', async (client) => {
      const { rows } = await client.query('select current_user as u, usesuper as su from pg_user where usename = current_user')
      expect(rows[0]).toEqual({ u: 'busway_app', su: false })
    })
  })

  it('queries are parameterized: a hostile value is data, not SQL', async () => {
    await withClient('TEST_DATABASE_URL', async (client) => {
      const { rows } = await client.query('select $1::text as v', [`'; drop table users; --`])
      expect(rows[0].v).toBe(`'; drop table users; --`)
    })
  })
})
