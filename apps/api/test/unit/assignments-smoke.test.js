import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.js'

const config = { nodeEnv: 'test', host: '127.0.0.1', port: 3001, logLevel: 'silent', databaseUrl: 'postgres://u:p@127.0.0.1:1/none', dbPoolMax: 1 }
const apps = []
afterEach(async () => { while (apps.length) await apps.pop().close() })

const ADMIN_UUID = '22222222-2222-2222-2222-222222222222'
const BUS_UUID = '33333333-3333-3333-3333-333333333333'
const DEVICE_UUID = '44444444-4444-4444-4444-444444444444'

function makePool(handler) {
  return {
    on() {},
    end: async () => {},
    query: async (sql, params) => handler(sql, params),
  }
}

function adminSessionPool(handler, permissions = ['assignments.manage', 'devices.manage'], role = 'admin') {
  return makePool(async (sql, params) => {
    if (/select s\.id/i.test(sql)) {
      return { rows: [{ id: 'sess-1', user_id: ADMIN_UUID, absolute_expires_at: new Date(Date.now() + 3600000), idle_expires_at: new Date(Date.now() + 1800000), revoked_at: null, user_status: 'active' }] }
    }
    if (/from user_roles/i.test(sql)) return { rows: [{ role }] }
    if (/from admin_permissions/i.test(sql)) return { rows: permissions.map((p) => ({ permission: p })) }
    return handler(sql, params)
  })
}

function noSessionPool(handler) {
  return makePool(async (sql, params) => {
    if (/select s\.id/i.test(sql)) return { rows: [] }
    return handler(sql, params)
  })
}

describe('assignments smoke (3.2.3)', () => {
  it('GET /admin/driver-assignments without session -> 401', async () => {
    const app = await buildApp({ config, pool: noSessionPool(async () => ({ rows: [] })) })
    apps.push(app)
    const res = await app.inject('/api/v1/admin/driver-assignments')
    expect(res.statusCode).toBe(401)
  })
  it('GET /admin/driver-assignments as driver -> 403', async () => {
    const app = await buildApp({ config, pool: adminSessionPool(async () => ({ rows: [] }), ['assignments.manage'], 'driver') })
    apps.push(app)
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/driver-assignments', headers: { cookie: 'session=tok; csrf=c' } })
    expect(res.statusCode).toBe(403)
  })
  it('GET /admin/driver-assignments admin without permission -> 403', async () => {
    const app = await buildApp({ config, pool: adminSessionPool(async () => ({ rows: [] }), []) })
    apps.push(app)
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/driver-assignments', headers: { cookie: 'session=tok; csrf=c' } })
    expect(res.statusCode).toBe(403)
  })
  it('POST /admin/driver-assignments invalid body -> 400', async () => {
    const app = await buildApp({ config, pool: adminSessionPool(async () => ({ rows: [] })) })
    apps.push(app)
    const res = await app.inject({ method: 'POST', url: '/api/v1/admin/driver-assignments', headers: { cookie: 'session=tok; csrf=c' }, payload: {} })
    expect(res.statusCode).toBe(400)
  })
  it('POST /admin/driver-assignments invalid uuid -> 400', async () => {
    const app = await buildApp({ config, pool: adminSessionPool(async () => ({ rows: [] })) })
    apps.push(app)
    const res = await app.inject({ method: 'POST', url: '/api/v1/admin/driver-assignments', headers: { cookie: 'session=tok; csrf=c' }, payload: { driverUserId: 'not-uuid', busId: BUS_UUID } })
    expect(res.statusCode).toBe(400)
  })
  it('POST /admin/driver-assignments success -> 201', async () => {
    const app = await buildApp({ config, pool: adminSessionPool(async () => ({ rows: [{ id: 'a1', driver_user_id: ADMIN_UUID, bus_id: BUS_UUID }] })) })
    apps.push(app)
    const res = await app.inject({ method: 'POST', url: '/api/v1/admin/driver-assignments', headers: { cookie: 'session=tok; csrf=c' }, payload: { driverUserId: ADMIN_UUID, busId: BUS_UUID } })
    expect(res.statusCode).toBe(201)
  })
  it('GET /admin/driver-assignments/:id not found -> 404', async () => {
    const app = await buildApp({ config, pool: adminSessionPool(async () => ({ rows: [] })) })
    apps.push(app)
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/driver-assignments/11111111-1111-1111-1111-111111111111', headers: { cookie: 'session=tok; csrf=c' } })
    expect(res.statusCode).toBe(404)
  })
  it('revoke assignment -> 200', async () => {
    const app = await buildApp({ config, pool: adminSessionPool(async () => ({ rows: [{ id: 'a1', revoked_at: new Date() }] })) })
    apps.push(app)
    const res = await app.inject({ method: 'POST', url: '/api/v1/admin/driver-assignments/11111111-1111-1111-1111-111111111111/revoke', headers: { cookie: 'session=tok; csrf=c' }, payload: { reason: 'test' } })
    expect(res.statusCode).toBe(200)
  })
  it('revoke already revoked -> 404', async () => {
    const app = await buildApp({ config, pool: adminSessionPool(async () => ({ rows: [] })) })
    apps.push(app)
    const res = await app.inject({ method: 'POST', url: '/api/v1/admin/driver-assignments/11111111-1111-1111-1111-111111111111/revoke', headers: { cookie: 'session=tok; csrf=c' }, payload: {} })
    expect(res.statusCode).toBe(404)
  })

  // GPS devices
  it('POST /admin/gps-devices invalid body -> 400', async () => {
    const app = await buildApp({ config, pool: adminSessionPool(async () => ({ rows: [] })) })
    apps.push(app)
    const res = await app.inject({ method: 'POST', url: '/api/v1/admin/gps-devices', headers: { cookie: 'session=tok; csrf=c' }, payload: {} })
    expect(res.statusCode).toBe(400)
  })
  it('POST /admin/gps-devices success -> 201', async () => {
    const app = await buildApp({ config, pool: adminSessionPool(async () => ({ rows: [{ id: DEVICE_UUID, external_id: 'dev-1' }] })) })
    apps.push(app)
    const res = await app.inject({ method: 'POST', url: '/api/v1/admin/gps-devices', headers: { cookie: 'session=tok; csrf=c' }, payload: { externalId: 'dev-1' } })
    expect(res.statusCode).toBe(201)
  })
  it('GET /admin/gps-devices without session -> 401', async () => {
    const app = await buildApp({ config, pool: noSessionPool(async () => ({ rows: [] })) })
    apps.push(app)
    const res = await app.inject('/api/v1/admin/gps-devices')
    expect(res.statusCode).toBe(401)
  })

  // GPS device assignments
  it('POST /admin/gps-device-assignments invalid uuid -> 400', async () => {
    const app = await buildApp({ config, pool: adminSessionPool(async () => ({ rows: [] })) })
    apps.push(app)
    const res = await app.inject({ method: 'POST', url: '/api/v1/admin/gps-device-assignments', headers: { cookie: 'session=tok; csrf=c' }, payload: { gpsDeviceId: 'bad', busId: BUS_UUID } })
    expect(res.statusCode).toBe(400)
  })
  it('POST /admin/gps-device-assignments success -> 201', async () => {
    const app = await buildApp({ config, pool: adminSessionPool(async () => ({ rows: [{ id: 'a2', gps_device_id: DEVICE_UUID, bus_id: BUS_UUID }] })) })
    apps.push(app)
    const res = await app.inject({ method: 'POST', url: '/api/v1/admin/gps-device-assignments', headers: { cookie: 'session=tok; csrf=c' }, payload: { gpsDeviceId: DEVICE_UUID, busId: BUS_UUID } })
    expect(res.statusCode).toBe(201)
  })

  // DB error mapping
  it('FK violation -> 409 CONFLICT', async () => {
    const err = new Error('fk'); err.code = '23503'
    const app = await buildApp({ config, pool: adminSessionPool(async (sql) => { if (/insert into driver_bus_assignments/i.test(sql)) throw err; return { rows: [{ id: 'a1' }] } }) })
    apps.push(app)
    const res = await app.inject({ method: 'POST', url: '/api/v1/admin/driver-assignments', headers: { cookie: 'session=tok; csrf=c' }, payload: { driverUserId: ADMIN_UUID, busId: BUS_UUID } })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('CONFLICT')
  })
  it('UNIQUE violation -> 409 CONFLICT', async () => {
    const err = new Error('uq'); err.code = '23505'
    const app = await buildApp({ config, pool: adminSessionPool(async (sql) => { if (/insert into driver_bus_assignments/i.test(sql)) throw err; return { rows: [{ id: 'a1' }] } }) })
    apps.push(app)
    const res = await app.inject({ method: 'POST', url: '/api/v1/admin/driver-assignments', headers: { cookie: 'session=tok; csrf=c' }, payload: { driverUserId: ADMIN_UUID, busId: BUS_UUID } })
    expect(res.statusCode).toBe(409)
  })
  it('EXCLUDE violation -> 409 CONFLICT', async () => {
    const err = new Error('ex'); err.code = '23P01'
    const app = await buildApp({ config, pool: adminSessionPool(async (sql) => { if (/insert into driver_bus_assignments/i.test(sql)) throw err; return { rows: [{ id: 'a1' }] } }) })
    apps.push(app)
    const res = await app.inject({ method: 'POST', url: '/api/v1/admin/driver-assignments', headers: { cookie: 'session=tok; csrf=c' }, payload: { driverUserId: ADMIN_UUID, busId: BUS_UUID } })
    expect(res.statusCode).toBe(409)
  })
  it('unknown DB error -> 500 (not 409)', async () => {
    const err = new Error('boom')
    const app = await buildApp({ config, pool: adminSessionPool(async (sql) => { if (/insert into driver_bus_assignments/i.test(sql)) throw err; return { rows: [{ id: 'a1' }] } }) })
    apps.push(app)
    const res = await app.inject({ method: 'POST', url: '/api/v1/admin/driver-assignments', headers: { cookie: 'session=tok; csrf=c' }, payload: { driverUserId: ADMIN_UUID, busId: BUS_UUID } })
    expect(res.statusCode).toBe(500)
  })
})