import { execFileSync } from 'node:child_process'
import { randomInt } from 'node:crypto'
import pg from 'pg'
import WebSocket from 'ws'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.js'
import { hashPassword } from '../../src/lib/password.js'
import { newPublicId } from '../../src/lib/ids.js'

// REAL Traccar 6.6 (container busway-traccar-test) -> REAL Fastify -> PostgreSQL -> WebSocket.
// Synthetic positions are sent over the OsmAnd protocol to Traccar's loopback port; this test never
// posts to the Fastify ingest endpoint itself. Opt-in: BUSWAY_E2E_TRACCAR=1 (+ isolated DB identity check).
const enabled = process.env.BUSWAY_E2E_TRACCAR === '1'
const run = enabled ? describe : describe.skip
const SECRET = 'synthetic-test-secret' // must match forward.header in the test traccar.xml
const TRACCAR = 'http://127.0.0.1:8082/api'
const OSMAND = 'http://127.0.0.1:5055'
const AUTH = 'Basic ' + Buffer.from('bw-test@example.test:Synthetic-Test-Pw-1').toString('base64')
const PASSWORD = 'e2e-driver-password'
const FASTIFY_PORT = 3001

function assertIsolatedDb() {
  const ports = JSON.parse(execFileSync('docker', ['inspect', 'busway-test-postgres-iso', '--format', '{{json .HostConfig.PortBindings}}'], { encoding: 'utf8' }))
  const b = ports['5432/tcp']?.[0]
  if (!b || b.HostIp !== '127.0.0.1' || b.HostPort !== '55433') throw new Error('isolated DB identity check failed')
  const t = JSON.parse(execFileSync('docker', ['inspect', 'busway-traccar-test', '--format', '{{json .HostConfig.PortBindings}}'], { encoding: 'utf8' }))
  for (const k of Object.keys(t)) for (const x of t[k]) if (x.HostIp !== '127.0.0.1') throw new Error('Traccar port is not loopback-only')
}

async function traccarApi(path, init = {}) {
  const res = await fetch(`${TRACCAR}${path}`, { ...init, headers: { authorization: AUTH, 'content-type': 'application/json', ...(init.headers ?? {}) } })
  return res.json()
}

run('Real Traccar -> Fastify -> PostgreSQL -> grant -> WebSocket', () => {
  const tag = `tc${randomInt(1e9)}`
  const ids = {}
  let admin, appPool, app, cookie, csrf, uniqueId, traccarDeviceId, unknownUniqueId
  const sockets = []
  const config = { nodeEnv: 'test', host: '127.0.0.1', port: FASTIFY_PORT, logLevel: 'silent', databaseUrl: 'postgres://x:y@127.0.0.1:5432/busway', dbPoolMax: 1, wsExpiryCheckMs: 300 }
  let clock = Math.floor(Date.now() / 1000) - 1

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const count = async (sql, params) => Number((await admin.query(sql, params)).rows[0].n)
  const driverPost = (url, payload) => app.inject({ method: 'POST', url, payload: payload ?? {}, headers: { cookie, 'x-csrf-token': csrf } })
  const driverDelete = (url) => app.inject({ method: 'DELETE', url, headers: { cookie, 'x-csrf-token': csrf } })
  const startApp = async () => { app = await buildApp({ config, pool: appPool }); await app.listen({ host: '127.0.0.1', port: FASTIFY_PORT }) }

  // One OsmAnd fix to Traccar. Each call uses a distinct second, so every fix is a distinct measurement.
  async function sendFix({ id = uniqueId, lat = 40.0, lon = 70.0, speed = 10, ts } = {}) {
    const at = ts ?? ++clock
    const res = await fetch(`${OSMAND}/?id=${id}&lat=${lat}&lon=${lon}&timestamp=${at}&speed=${speed}&bearing=90`)
    expect(res.status).toBe(200)
    return at
  }
  const sourceId = (at) => `tc${traccarDeviceId}-${at * 1000}`
  async function waitCount(at, expected, ms = 15000) {
    const end = Date.now() + ms
    while (Date.now() < end) {
      if (await count('select count(*) n from gps_positions where source_position_id = $1', [sourceId(at)]) === expected) return true
      await sleep(100)
    }
    return false
  }
  async function openSocket() {
    const ws = new WebSocket(`ws://127.0.0.1:${FASTIFY_PORT}/ws/v1/live`)
    const messages = []
    ws.on('message', (d) => messages.push(JSON.parse(d.toString())))
    await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject) })
    sockets.push(ws)
    const waitFor = async (predicate, ms = 8000) => {
      const end = Date.now() + ms
      while (Date.now() < end) { const f = messages.find(predicate); if (f) return f; await sleep(25) }
      throw new Error(`timeout; got ${JSON.stringify(messages.map((m) => m.type))}`)
    }
    await waitFor((m) => m.type === 'snapshot')
    return { messages, waitFor }
  }

  beforeAll(async () => {
    assertIsolatedDb()
    process.env.INTERNAL_GPS_SECRET = SECRET
    admin = new pg.Pool({ host: '127.0.0.1', port: 55433, database: 'busway_test', user: 'busway_admin', password: 'iso-admin-pw', ssl: false, max: 2 })
    appPool = new pg.Pool({ host: '127.0.0.1', port: 55433, database: 'busway_test', user: 'busway_app', password: 'iso-app-pw', ssl: false, max: 5 })

    // Traccar-side devices (idempotent): one that BusWay registers, one that it does not know.
    const devices = await traccarApi('/devices')
    const ensure = async (uid) => devices.find((d) => d.uniqueId === uid) ?? traccarApi('/devices', { method: 'POST', body: JSON.stringify({ name: uid, uniqueId: uid }) })
    uniqueId = 'bw-synth-1'
    unknownUniqueId = 'bw-synth-unknown'
    traccarDeviceId = (await ensure(uniqueId)).id
    const unknown = await ensure(unknownUniqueId)
    expect(unknown.id).not.toBe(traccarDeviceId)
    expect(await count('select count(*) n from gps_devices where traccar_device_id = $1', [traccarDeviceId])).toBe(0)

    ids.city = (await admin.query('insert into cities(public_id,name_ru,name_ky) values ($1,$2,$2) returning id', [newPublicId('city'), `${tag} city`])).rows[0].id
    ids.bus = (await admin.query('insert into buses(city_id,internal_number) values ($1,$2) returning id, public_id', [ids.city, tag])).rows[0]
    ids.email = `${tag}@example.test`
    ids.driver = (await admin.query('insert into users(public_id,email,password_hash) values ($1,$2,$3) returning id', [newPublicId('usr'), ids.email, await hashPassword(PASSWORD)])).rows[0].id
    await admin.query("insert into user_roles(user_id,role) values ($1,'driver')", [ids.driver])
    ids.device = (await admin.query("insert into gps_devices(external_id,traccar_device_id,status) values ($1,$2,'active') returning id", [`${tag}-dev`, traccarDeviceId])).rows[0].id
    await admin.query('insert into gps_device_assignments(gps_device_id,bus_id,created_by) values ($1,$2,$3)', [ids.device, ids.bus.id, ids.driver])
    await admin.query('insert into driver_bus_assignments(driver_user_id,bus_id,created_by) values ($1,$2,$1)', [ids.driver, ids.bus.id])

    await startApp()
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: ids.email, password: PASSWORD } })
    expect(login.statusCode).toBe(200)
    const cookies = [].concat(login.headers['set-cookie']).map((c) => c.split(';')[0])
    cookie = cookies.join('; ')
    csrf = cookies.find((c) => c.startsWith('csrf=')).slice(5)
  })

  afterAll(async () => {
    for (const ws of sockets) ws.terminate()
    if (app) await app.close().catch(() => {})
    if (admin && ids.city) {
      await admin.query('delete from gps_gateway_messages where device_external_id = $1', [`${tag}-dev`])
      await admin.query('delete from vehicle_live_states where bus_id = $1', [ids.bus.id])
      await admin.query('delete from gps_positions where bus_id = $1', [ids.bus.id])
      await admin.query('delete from public_visibility_grants where bus_id = $1', [ids.bus.id])
      await admin.query('delete from trips where bus_id = $1', [ids.bus.id])
      await admin.query('delete from gps_device_assignments where bus_id = $1', [ids.bus.id])
      await admin.query('delete from driver_bus_assignments where bus_id = $1', [ids.bus.id])
      await admin.query('delete from gps_devices where id = $1', [ids.device])
      await admin.query('delete from buses where id = $1', [ids.bus.id])
      await admin.query('delete from sessions where user_id = $1', [ids.driver])
      await admin.query('delete from user_roles where user_id = $1', [ids.driver])
      await admin.query('delete from users where id = $1', [ids.driver])
      await admin.query('delete from cities where id = $1', [ids.city])
    }
    await appPool?.end()
    await admin?.end()
  })

  it('a real Traccar forward is accepted, stored, and NOT published without a grant', async () => {
    const { messages } = await openSocket()
    const at = await sendFix()
    expect(await waitCount(at, 1)).toBe(true)
    await sleep(500)
    expect(messages.some((m) => m.type === 'vehicle.position')).toBe(false)
    const state = (await admin.query('select freshness from vehicle_live_states where bus_id = $1', [ids.bus.id])).rows[0]
    expect(state.freshness).toBe('live')
  })

  it('shows the bus after the driver enables a grant, then follows coordinates live', async () => {
    const { waitFor } = await openSocket()
    const grant = await driverPost('/api/v1/driver/public-visibility', { expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() })
    expect(grant.statusCode, grant.body).toBe(201)
    const shown = await waitFor((m) => m.type === 'vehicle.position')
    expect(shown.vehicle.vehiclePublicId).toBe(ids.bus.public_id)
    await sendFix({ lat: 40.0123, lon: 70.0456, speed: 0 })
    const moved = await waitFor((m) => m.type === 'vehicle.position' && Math.abs(m.vehicle.latitude - 40.0123) < 1e-9)
    expect(moved.vehicle.longitude).toBeCloseTo(70.0456, 6)
    expect(moved.vehicle.speedMps).toBe(0)
  })

  it('a completed trip does not hide the bus', async () => {
    const { messages, waitFor } = await openSocket()
    expect(messages.find((m) => m.type === 'snapshot').vehicles).toHaveLength(1)
    const trip = await driverPost('/api/v1/driver/trips', {})
    expect(trip.statusCode, trip.body).toBe(201)
    expect((await driverPost(`/api/v1/driver/trips/${trip.json().trip.id}/complete`)).statusCode).toBe(200)
    await sendFix({ lat: 40.0124, lon: 70.0457, speed: 0 })
    await waitFor((m) => m.type === 'vehicle.position' && Math.abs(m.vehicle.latitude - 40.0124) < 1e-9)
    expect(messages.some((m) => m.type === 'vehicle.removed')).toBe(false)
  })

  it('a position from a Traccar device that BusWay did not register is rejected', async () => {
    const before = await count('select count(*) n from gps_positions where bus_id = $1', [ids.bus.id])
    const at = await sendFix({ id: unknownUniqueId, lat: 41, lon: 71 })
    await sleep(3000)
    expect(await count('select count(*) n from gps_positions where gps_device_id is not null and source_position_id = $1', [`tc${(await traccarApi('/devices')).find((d) => d.uniqueId === unknownUniqueId).id}-${at * 1000}`])).toBe(0)
    expect(await count('select count(*) n from gps_positions where bus_id = $1', [ids.bus.id])).toBe(before)
  })

  it('a repeated fix does not create a second position', async () => {
    const at = await sendFix()
    expect(await waitCount(at, 1)).toBe(true)
    await sendFix({ ts: at })
    await sleep(2500)
    expect(await count('select count(*) n from gps_positions where source_position_id = $1', [sourceId(at)])).toBe(1)
  })

  it('Fastify down for a moment: Traccar retries and the fix arrives exactly once', async () => {
    await app.close()
    const at = await sendFix({ lat: 40.02, lon: 70.02 })
    await sleep(1200)
    await startApp()
    expect(await waitCount(at, 1, 20000)).toBe(true)
    await sleep(2000)
    expect(await count('select count(*) n from gps_positions where source_position_id = $1', [sourceId(at)])).toBe(1)
  })

  it('manual disable removes the bus; a late and a fresh fix do not bring it back', async () => {
    const { messages, waitFor } = await openSocket()
    expect(messages.find((m) => m.type === 'snapshot').vehicles).toHaveLength(1)
    expect((await driverDelete('/api/v1/driver/public-visibility')).statusCode).toBe(200)
    const removed = await waitFor((m) => m.type === 'vehicle.removed')
    expect(removed.vehiclePublicId).toBe(ids.bus.public_id)
    messages.length = 0
    const lateTs = Math.floor(Date.now() / 1000) - 600
    const lateAt = await sendFix({ ts: lateTs, lat: 40.5 })
    const freshAt = await sendFix({ lat: 40.6 })
    expect(await waitCount(lateAt, 1)).toBe(true)
    expect(await waitCount(freshAt, 1)).toBe(true)
    await sleep(800)
    expect(messages.some((m) => m.type === 'vehicle.position')).toBe(false)
    const again = await openSocket()
    expect(again.messages.find((m) => m.type === 'snapshot').vehicles).toEqual([])
  })
})
