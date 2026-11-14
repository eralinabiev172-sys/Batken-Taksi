import Type from 'typebox'
import { afterEach, describe, expect, it } from 'vitest'
import Value from 'typebox/value'
import { ErrorResponseSchema } from '@busway-kg/contracts'
import { buildApp } from '../../src/app.js'

const SECRET_URL_PASSWORD = 'unit-test-password'
const config = {
  nodeEnv: 'test',
  host: '127.0.0.1',
  port: 3001,
  logLevel: 'silent',
  databaseUrl: `postgres://u:${SECRET_URL_PASSWORD}@127.0.0.1:1/none`,
  dbPoolMax: 1,
}

const apps = []
async function makeApp(options = {}) {
  const app = await buildApp({ config, ...options })
  apps.push(app)
  return app
}
afterEach(async () => {
  while (apps.length) await apps.pop().close()
})

describe('health', () => {
  it('GET /health is ok and exposes nothing else', async () => {
    const app = await makeApp()
    const res = await app.inject('/health')
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok' })
  })

  it('readiness returns 503 in the documented error format when the database is down', async () => {
    const pool = { on() {}, query: async () => { throw new Error(`connect failed ${SECRET_URL_PASSWORD}`) }, end: async () => {} }
    const app = await makeApp({ pool })
    const res = await app.inject('/health/ready')
    expect(res.statusCode).toBe(503)
    expect(Value.Check(ErrorResponseSchema, res.json())).toBe(true)
    expect(res.json().error.code).toBe('SERVICE_UNAVAILABLE')
    expect(res.body).not.toContain(SECRET_URL_PASSWORD)
  })

  it('readiness is ok when the database answers', async () => {
    const pool = { on() {}, query: async () => ({ rows: [{ '?column?': 1 }] }), end: async () => {} }
    const app = await makeApp({ pool })
    const res = await app.inject('/health/ready')
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok', database: 'up' })
  })
})

describe('security headers', () => {
  it('sets baseline headers, disables caching and hides the framework', async () => {
    const app = await makeApp()
    const res = await app.inject('/health')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.headers['content-security-policy']).toContain("default-src 'none'")
    expect(res.headers['x-powered-by']).toBeUndefined()
    expect(res.headers['referrer-policy']).toBe('no-referrer')
  })
})

describe('error format', () => {
  it('404 uses { error: { code, message, requestId } }', async () => {
    const app = await makeApp()
    const res = await app.inject('/nope')
    expect(res.statusCode).toBe(404)
    expect(Value.Check(ErrorResponseSchema, res.json())).toBe(true)
    expect(res.json().error.code).toBe('NOT_FOUND')
  })

  it('request ids are server generated; a client-supplied id is ignored', async () => {
    const app = await makeApp()
    const res = await app.inject({ url: '/nope', headers: { 'x-request-id': 'attacker-id' } })
    expect(res.json().error.requestId).not.toBe('attacker-id')
    expect(res.json().error.requestId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('500 hides internals', async () => {
    const app = await makeApp()
    app.get('/boom', async () => { throw new Error('SECRET INTERNAL DETAIL') })
    const res = await app.inject('/boom')
    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe('INTERNAL_ERROR')
    expect(res.body).not.toContain('SECRET INTERNAL DETAIL')
    expect(Value.Check(ErrorResponseSchema, res.json())).toBe(true)
  })

  it('oversized body returns 413 in the documented format', async () => {
    const app = await makeApp()
    app.post('/echo', async () => ({ ok: true }))
    const res = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ blob: 'x'.repeat(70 * 1024) }),
    })
    expect(res.statusCode).toBe(413)
    expect(res.json().error.code).toBe('PAYLOAD_TOO_LARGE')
  })
})

describe('request validation (D-104)', () => {
  const bodySchema = Type.Object({ name: Type.String({ minLength: 1 }) }, { additionalProperties: false })

  async function appWithRoute() {
    const app = await makeApp()
    app.post('/echo', { schema: { body: bodySchema } }, async (request) => ({ name: request.body.name }))
    return app
  }

  it('accepts a valid body', async () => {
    const app = await appWithRoute()
    const res = await app.inject({ method: 'POST', url: '/echo', payload: { name: 'ok' } })
    expect(res.statusCode).toBe(200)
  })

  it('rejects unexpected fields instead of silently stripping them (mass assignment)', async () => {
    const app = await appWithRoute()
    const res = await app.inject({ method: 'POST', url: '/echo', payload: { name: 'ok', role: 'admin' } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('VALIDATION_ERROR')
    expect(Value.Check(ErrorResponseSchema, res.json())).toBe(true)
  })

  it('rejects wrong types and missing fields and does not echo submitted values', async () => {
    const app = await appWithRoute()
    const wrong = await app.inject({ method: 'POST', url: '/echo', payload: { name: 12345 } })
    expect(wrong.statusCode).toBe(400)
    expect(wrong.body).not.toContain('12345')
    const missing = await app.inject({ method: 'POST', url: '/echo', payload: {} })
    expect(missing.statusCode).toBe(400)
  })
})
