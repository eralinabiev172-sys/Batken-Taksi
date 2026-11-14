import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.js'

const config = { nodeEnv: 'test', host: '127.0.0.1', port: 3001, logLevel: 'silent', databaseUrl: 'postgres://u:p@127.0.0.1:1/none', dbPoolMax: 1 }
const apps = []
afterEach(async () => { while (apps.length) await apps.pop().close() })

function makePool() {
  return { on() {}, query: async () => ({ rows: [] }), end: async () => {} }
}

describe('fleet admin smoke (3.2.2)', () => {
  it('GET /api/v1/admin/buses without session -> 401', async () => {
    const app = await buildApp({ config, pool: makePool() })
    apps.push(app)
    const res = await app.inject('/api/v1/admin/buses')
    expect(res.statusCode).toBe(401)
  })
  it('POST /api/v1/admin/buses without session -> 401', async () => {
    const app = await buildApp({ config, pool: makePool() })
    apps.push(app)
    const res = await app.inject({ method: 'POST', url: '/api/v1/admin/buses', payload: { cityId: 'x', internalNumber: '1' } })
    expect(res.statusCode).toBe(401)
  })
  it('POST /api/v1/admin/stops with invalid body -> 400/401', async () => {
    const app = await buildApp({ config, pool: makePool() })
    apps.push(app)
    const res = await app.inject({ method: 'POST', url: '/api/v1/admin/stops', payload: {} })
    expect([400, 401]).toContain(res.statusCode)
  })
})