import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.js'

// Regression: routes once passed the whole parsed-cookie object to resolveSession(), so every
// request to them was answered 401 even with a valid session. Found by the real-DB e2e run.
const config = { nodeEnv: 'test', host: '127.0.0.1', port: 3001, logLevel: 'silent', databaseUrl: 'postgres://u:p@127.0.0.1:1/none', dbPoolMax: 1 }
const apps = []
afterEach(async () => { while (apps.length) await apps.pop().close() })

function pool(role) {
  return { on() {}, end: async () => {}, query: async (sql) => {
    if (/select s\.id/i.test(sql)) return { rows: [{ id: 's', user_id: '22222222-2222-2222-2222-222222222222', absolute_expires_at: new Date(Date.now() + 3.6e6), idle_expires_at: new Date(Date.now() + 1.8e6), revoked_at: null, user_status: 'active' }] }
    if (/from user_roles/i.test(sql)) return { rows: [{ role }] }
    return { rows: [] }
  } }
}

describe('session token is read from the session cookie', () => {
  const cases = [
    ['driver', '/api/v1/driver/trips/active'],
    ['driver', '/api/v1/driver/public-visibility'],
    ['admin', '/api/v1/admin/fault-reports'],
    ['admin', '/api/v1/admin/audit-logs'],
  ]
  for (const [role, url] of cases) {
    it(`GET ${url} with a valid session -> 200`, async () => {
      const app = await buildApp({ config, pool: pool(role) })
      apps.push(app)
      const res = await app.inject({ method: 'GET', url, headers: { cookie: 'session=valid-token' } })
      expect(res.statusCode).toBe(200)
    })
    it(`GET ${url} without the session cookie -> 401`, async () => {
      const app = await buildApp({ config, pool: pool(role) })
      apps.push(app)
      const res = await app.inject({ method: 'GET', url, headers: { cookie: 'other=valid-token' } })
      expect(res.statusCode).toBe(401)
    })
  }
})
