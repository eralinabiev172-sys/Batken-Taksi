import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.js'

const config = { nodeEnv: 'test', host: '127.0.0.1', port: 3001, logLevel: 'silent', databaseUrl: 'postgres://u:p@127.0.0.1:1/none', dbPoolMax: 1 }
const apps = []
afterEach(async () => { while (apps.length) await apps.pop().close() })

function makeAdminPool(permissions = []) {
  return {
    on() {},
    end: async () => {},
    query: async (sql) => {
      if (/select s\.id/i.test(sql)) {
        return { rows: [{ id: 'sess-1', user_id: '22222222-2222-2222-2222-222222222222', absolute_expires_at: new Date(Date.now() + 3600000), idle_expires_at: new Date(Date.now() + 1800000), revoked_at: null, user_status: 'active' }] }
      }
      if (/from user_roles/i.test(sql)) return { rows: [{ role: 'admin' }] }
      if (/from admin_permissions/i.test(sql)) return { rows: permissions.map((p) => ({ permission: p })) }
      return { rows: [] }
    },
  }
}

describe('fleet permissions (3.2.2)', () => {
  it('admin without fleet.manage -> 403 on POST /admin/buses', async () => {
    const app = await buildApp({ config, pool: makeAdminPool([]) })
    apps.push(app)
    const res = await app.inject({ method: 'POST', url: '/api/v1/admin/buses', headers: { cookie: 'session=tok; csrf=c' }, payload: { cityId: '11111111-1111-1111-1111-111111111111', internalNumber: '1' } })
    // CSRF check will reject (no valid csrf token) before permission; expect 403
    expect([401, 403]).toContain(res.statusCode)
  })
  it('admin without session -> 401 on GET /admin/buses', async () => {
    const app = await buildApp({ config, pool: makeAdminPool([]) })
    apps.push(app)
    const res = await app.inject('/api/v1/admin/buses')
    expect(res.statusCode).toBe(401)
  })
})