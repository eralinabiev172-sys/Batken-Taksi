import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.js'
import { hashPassword } from '../../src/lib/password.js'

const config = {
  nodeEnv: 'test', host: '127.0.0.1', port: 3001, logLevel: 'silent',
  databaseUrl: 'postgres://u:p@127.0.0.1:1/none', dbPoolMax: 1,
}

const apps = []
afterEach(async () => { while (apps.length) await apps.pop().close() })

function makePool(overrides = {}) {
  const q = async (sql, params) => {
    if (/from users where lower\(email\)/i.test(sql)) {
      if (params?.[0] === 'admin@test.local') {
        return { rows: [{ id: '11111111-1111-1111-1111-111111111111', password_hash: await hashPassword('secret'), status: 'active' }] }
      }
      return { rows: [] }
    }
    if (/from user_roles/i.test(sql)) return { rows: [{ role: 'admin' }] }
    if (/from admin_permissions/i.test(sql)) return { rows: [{ permission: 'admin.manage' }] }
    if (/insert into sessions/i.test(sql)) return { rows: [] }
    if (/update sessions/i.test(sql)) return { rows: [] }
    if (/select s.id/i.test(sql)) return { rows: [{ id: 'sess-1', user_id: '11111111-1111-1111-1111-111111111111', absolute_expires_at: new Date(Date.now() + 3600000), idle_expires_at: new Date(Date.now() + 1800000), revoked_at: null, user_status: 'active' }] }
    return { rows: [] }
  }
  return { on() {}, query: q, end: async () => {}, ...overrides }
}

describe('auth smoke (3.2.1)', () => {
  it('GET /api/v1/auth/me without session -> 401', async () => {
    const app = await buildApp({ config, pool: makePool() })
    apps.push(app)
    const res = await app.inject('/api/v1/auth/me')
    expect(res.statusCode).toBe(401)
  })
  it('POST /api/v1/auth/login with wrong creds -> 401', async () => {
    const app = await buildApp({ config, pool: makePool() })
    apps.push(app)
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'x@test.local', password: 'nope' } })
    expect(res.statusCode).toBe(401)
  })
  it('POST /api/v1/auth/login with valid creds -> 200 + session cookie', async () => {
    const app = await buildApp({ config, pool: makePool() })
    apps.push(app)
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'admin@test.local', password: 'secret' } })
    expect(res.statusCode).toBe(200)
    expect(res.headers['set-cookie']).toBeTruthy()
  })
  it('POST /api/v1/auth/logout -> 204', async () => {
    const app = await buildApp({ config, pool: makePool() })
    apps.push(app)
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/logout' })
    expect(res.statusCode).toBe(204)
  })

  it('login -> me -> logout flow', async () => {
    const app = await buildApp({ config, pool: makePool() })
    apps.push(app)
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'admin@test.local', password: 'secret' } })
    expect(login.statusCode).toBe(200)
    const raw = login.headers['set-cookie']
    const arr = Array.isArray(raw) ? raw : (raw ? [raw] : [])
    const cookies = arr.map((c) => c.split(';')[0]).join('; ')
    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: cookies } })
    expect(me.statusCode).toBe(200)
    const logout = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { cookie: cookies } })
    expect(logout.statusCode).toBe(204)
  })

  it('access denied without session on protected route -> 401', async () => {
    const app = await buildApp({ config, pool: makePool() })
    apps.push(app)
    const res = await app.inject('/api/v1/auth/me')
    expect(res.statusCode).toBe(401)
  })
})