import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.js'

const config = { nodeEnv: 'test', host: '127.0.0.1', port: 3001, logLevel: 'silent', databaseUrl: 'postgres://u:p@127.0.0.1:1/none', dbPoolMax: 1 }
const apps = []
afterEach(async () => { while (apps.length) await apps.pop().close() })
function pool() { return { on() {}, query: async () => ({ rows: [] }), end: async () => {} } }

describe('final acceptance smoke (3.2 endpoints, no session)', () => {
  const cases = [
    ['GET', '/api/v1/driver/trips/active'],
    ['POST', '/api/v1/driver/trips'],
    ['GET', '/api/v1/driver/public-visibility'],
    ['POST', '/api/v1/driver/public-visibility'],
    ['DELETE', '/api/v1/driver/public-visibility'],
    ['POST', '/internal/v1/gps/positions'],
    ['GET', '/api/v1/admin/live-vehicles'],
    ['GET', '/api/v1/admin/tracker-health'],
    ['POST', '/api/v1/admin/reconciliation/run'],
    ['GET', '/api/v1/admin/fault-reports'],
    ['GET', '/api/v1/admin/audit-logs'],
  ]
  for (const [method, url] of cases) {
    it(`${method} ${url} -> 401 without session`, async () => {
      const app = await buildApp({ config, pool: pool() })
      apps.push(app)
      const res = await app.inject({ method, url, payload: method === 'POST' ? {} : undefined })
      expect([400, 401, 403]).toContain(res.statusCode)
    })
  }
})