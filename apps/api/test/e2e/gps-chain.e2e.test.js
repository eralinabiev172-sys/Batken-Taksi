import { execFileSync } from 'node:child_process'
import { randomInt } from 'node:crypto'
import pg from 'pg'
import WebSocket from 'ws'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.js'
import { hashPassword } from '../../src/lib/password.js'
import { newPublicId } from '../../src/lib/ids.js'

// Real Fastify + real PostgreSQL (disposable container) + real WebSocket client.
// Synthetic data only. Opt-in: BUSWAY_E2E_ISO=1. Rows created here are removed in afterAll.
const enabled = process.env.BUSWAY_E2E_ISO === '1'
const CONTAINER = 'busway-test-postgres-iso'
const PORT = 55433
const SECRET = 'e2e-gateway-secret'
const PASSWORD = 'e2e-driver-password'

const run = enabled ? describe : describe.skip

function assertIsolatedContainer() {
  const ports = JSON.parse(execFileSync('docker', ['inspect', CONTAINER, '--format', '{{json .HostConfig.PortBindings}}'], { encoding: 'utf8' }))
  const binding = ports['5432/tcp']?.[0]
  if (!binding || binding.HostIp !== '127.0.0.1' || binding.HostPort !== String(PORT)) throw new Error('isolated container identity check failed')
  const mounts = execFileSync('docker', ['inspect', CONTAINER, '--format', '{{range .Mounts}}{{.Name}} {{end}}'], { encoding: 'utf8' })
  if (!mounts.includes('busway_iso_test_pgdata') || mounts.includes('busway_pgdata ')) throw new Error('isolated container volume check failed')
}

const conn = (user, password) => ({ host: '127.0.0.1', port: PORT, database: 'busway_test', user, password, ssl: false })

run('GPS chain: Traccar forward -> Fastify -> PostgreSQL -> grant -> WebSocket', () => {
  const ids = {}
  const tag = `e2e${randomInt(1e9)}`
  const traccarId = 900000 + randomInt(90000)
  const archivedTraccarId = traccarId + 1
  let admin, appPool, app, baseUrl, cookie, csrf
  const sockets = []
  let positionSeq = 0

  const post = (url, payload, headers = {}) => app.inject({ method: 'POST', url, payload, headers })
  const driverPost = (url, payload) => app.inject({ method: 'POST', url, payload: payload ?? {}, headers: { cookie, 'x-csrf-token': csrf } })
  const driverDelete = (url) => app.inject({ method: 'DELETE', url, headers: { cookie, 'x-csrf-token': csrf } })
  const traccar = (positions, secret = SECRET) => post('/internal/v1/gps/traccar', positions, { 'x-gateway-secret': secret })
  const fix = (overrides = {}) => ({
    id: ++positionSeq + 1000000 * (randomInt(1000) + 1), deviceId: traccarId, protocol: 'teltonika',
    fixTime: new Date().toISOString(), latitude: 40.0, longitude: 70.0, speed: 10, course: 90, ...overrides,
  })

  async function openSocket() {
    const ws = new WebSocket(`${baseUrl}/ws/v1/live`)
    const messages = []
    ws.on('message', (d) => messages.push(JSON.parse(d.toString())))
    await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject) })
    sockets.push(ws)
    const waitFor = async (predicate, ms = 4000) => {
      const end = Date.now() + ms
      while (Date.now() < end) {
        const found = messages.find(predicate)
        if (found) return found
        await new Promise((r) => setTimeout(r, 25))
      }
      throw new Error(`timeout waiting for message; got ${JSON.stringify(messages.map((m) => m.type))}`)
    }
    await waitFor((m) => m.type === 'snapshot')
    return { ws, messages, waitFor }
  }
  const quiet = (ms = 400) => new Promise((r) => setTimeout(r, ms))
  const count = async (sql, params) => Number((await admin.query(sql, params)).rows[0].n)

  beforeAll(async () => {
    assertIsolatedContainer()
    process.env.INTERNAL_GPS_SECRET = SECRET
    admin = new pg.Pool({ ...conn('busway_admin', 'iso-admin-pw'), max: 2 })
    appPool = new pg.Pool({ ...conn('busway_app', 'iso-app-pw'), max: 5 })
    const who = (await admin.query('select current_database() d, inet_server_port() p')).rows[0]
    if (who.d !== 'busway_test') throw new Error('wrong database')

    ids.city = (await admin.query(`insert into cities(public_id,name_ru,name_ky) values ($1,$2,$2) returning id`, [newPublicId('city'), `${tag} city`])).rows[0].id
    ids.bus = (await admin.query(`insert into buses(public_id,city_id,internal_number) values ($1,$2,$3) returning id, public_id`, [newPublicId('bus'), ids.city, tag])).rows[0]
    ids.email = `${tag}@example.test`
    ids.driver = (await admin.query(`insert into users(public_id,email,password_hash) values ($1,$2,$3) returning id`, [newPublicId('usr'), ids.email, await hashPassword(PASSWORD)])).rows[0].id
    await admin.query(`insert into user_roles(user_id,role) values ($1,'driver')`, [ids.driver])
    ids.device = (await admin.query(`insert into gps_devices(public_id,external_id,traccar_device_id,status) values ($1,$2,$3,'active') returning id`, [newPublicId('dev'), `${tag}-dev`, traccarId])).rows[0].id
    ids.archived = (await admin.query(`insert into gps_devices(public_id,external_id,traccar_device_id,status) values ($1,$2,$3,'archived') returning id`, [newPublicId('dev'), `${tag}-arch`, archivedTraccarId])).rows[0].id
    await admin.query(`insert into gps_device_assignments(gps_device_id,bus_id,created_by) values ($1,$2,$3)`, [ids.device, ids.bus.id, ids.driver])
    await admin.query(`insert into driver_bus_assignments(public_id,driver_user_id,bus_id,created_by) values ($1,$2,$3,$2)`, [newPublicId('asg'), ids.driver, ids.bus.id])

    app = await buildApp({ config: { nodeEnv: 'test', host: '127.0.0.1', port: 0, logLevel: 'silent', databaseUrl: 'postgres://x:y@127.0.0.1:5432/busway', dbPoolMax: 1, wsExpiryCheckMs: 300 }, pool: appPool })
    await app.listen({ host: '127.0.0.1', port: 0 })
    baseUrl = `ws://127.0.0.1:${app.server.address().port}`

    const login = await post('/api/v1/auth/login', { email: ids.email, password: PASSWORD })
    expect(login.statusCode).toBe(200)
    const cookies = [].concat(login.headers['set-cookie']).map((c) => c.split(';')[0])
    cookie = cookies.join('; ')
    csrf = cookies.find((c) => c.startsWith('csrf=')).slice(5)
  })

  afterAll(async () => {
    for (const ws of sockets) ws.terminate()
    if (app) await app.close()
    if (admin && ids.city) {
      const dev = [ids.device, ids.archived].filter(Boolean)
      await admin.query(`delete from gps_gateway_messages where device_external_id like $1`, [`${tag}%`])
      await admin.query(`delete from vehicle_live_states where bus_id = $1`, [ids.bus.id])
      await admin.query(`delete from gps_positions where bus_id = $1`, [ids.bus.id])
      await admin.query(`delete from public_visibility_grants where bus_id = $1`, [ids.bus.id])
      await admin.query(`delete from trips where bus_id = $1`, [ids.bus.id])
      await admin.query(`delete from gps_device_assignments where bus_id = $1`, [ids.bus.id])
      await admin.query(`delete from driver_bus_assignments where bus_id = $1`, [ids.bus.id])
      await admin.query(`delete from gps_devices where id = any($1::uuid[])`, [dev])
      await admin.query(`delete from buses where id = $1`, [ids.bus.id])
      await admin.query(`delete from sessions where user_id = $1`, [ids.driver])
      await admin.query(`delete from user_roles where user_id = $1`, [ids.driver])
      await admin.query(`delete from users where id = $1`, [ids.driver])
      await admin.query(`delete from cities where id = $1`, [ids.city])
    }
    await appPool?.end()
    await admin?.end()
  })

  it('rejects a wrong gateway secret and an unknown/archived Traccar device', async () => {
    expect((await traccar(fix(), 'wrong')).statusCode).toBe(401)
    expect((await traccar(fix({ deviceId: 5 }))).statusCode).toBe(404)
    expect((await traccar(fix({ deviceId: archivedTraccarId }))).statusCode).toBe(404)
    expect(await count('select count(*) n from gps_positions where bus_id = $1', [ids.bus.id])).toBe(0)
  })

  it('stores a position but publishes nothing while no grant exists', async () => {
    const { messages, waitFor } = await openSocket()
    expect(messages.find((m) => m.type === 'snapshot').vehicles).toEqual([])
    const res = await traccar(fix())
    expect(res.statusCode).toBe(200)
    expect(res.json().results[0].body.status).toBe('accepted')
    await quiet()
    expect(messages.some((m) => m.type === 'vehicle.position')).toBe(false)
    expect(await count('select count(*) n from gps_positions where bus_id = $1', [ids.bus.id])).toBe(1)
    await expect(waitFor((m) => m.type === 'vehicle.position', 200)).rejects.toThrow()
  })

  it('shows the bus when the driver enables a grant, and updates coordinates live', async () => {
    const { messages, waitFor } = await openSocket()
    const exp = new Date(Date.now() + 10 * 60_000).toISOString()
    const grant = await driverPost('/api/v1/driver/public-visibility', { expiresAt: exp })
    expect(grant.statusCode, grant.body).toBe(201)
    const shown = await waitFor((m) => m.type === 'vehicle.position')
    expect(shown.vehicle.vehiclePublicId).toBe(ids.bus.public_id)
    expect(JSON.stringify(shown)).not.toContain(ids.bus.id)
    expect(shown.vehicle).not.toHaveProperty('driver')

    messages.length = 0
    const res = await traccar(fix({ latitude: 40.001, longitude: 70.002, speed: 0 }))
    expect(res.statusCode).toBe(200)
    const moved = await waitFor((m) => m.type === 'vehicle.position' && Math.abs(m.vehicle.latitude - 40.001) < 1e-9)
    expect(moved.vehicle.longitude).toBeCloseTo(70.002, 6)
  })

  it('a parked bus stays visible and a completed trip does not hide it', async () => {
    const { messages, waitFor } = await openSocket()
    expect(messages.find((m) => m.type === 'snapshot').vehicles).toHaveLength(1)
    const trip = await driverPost('/api/v1/driver/trips', {})
    expect(trip.statusCode, trip.body).toBe(201)
    const done = await driverPost(`/api/v1/driver/trips/${trip.json().trip.id}/complete`)
    expect(done.statusCode, done.body).toBe(200)
    messages.length = 0
    const parked = await traccar(fix({ latitude: 40.001, longitude: 70.002, speed: 0 }))
    expect(parked.statusCode).toBe(200)
    await waitFor((m) => m.type === 'vehicle.position')
    expect(messages.some((m) => m.type === 'vehicle.removed')).toBe(false)
    const state = await app.inject({ method: 'GET', url: '/api/v1/driver/public-visibility', headers: { cookie } })
    expect(state.json().enabled).toBe(true)
  })

  it('does not duplicate a repeated position, and a batch retry is idempotent', async () => {
    const one = fix()
    expect((await traccar(one)).json().results[0].body.status).toBe('accepted')
    const again = await traccar(one)
    expect(again.statusCode).toBe(200)
    expect(again.json().results[0].body.status).toBe('duplicate')
    expect(await count('select count(*) n from gps_positions where source_position_id = $1', [String(one.id)])).toBe(1)

    const batch = [fix(), fix()]
    const first = await traccar(batch)
    expect(first.statusCode).toBe(200)
    const retry = await traccar(batch)
    expect(retry.json().results.map((r) => r.body.status)).toEqual(['duplicate', 'duplicate'])
    const mixed = await traccar([...batch, fix({ deviceId: 5 })])
    // Current contract: an unknown device rejects the whole request before ingesting anything.
    expect(mixed.statusCode).toBe(404)
  })

  it('manual disable removes the bus; late and fresh packets do not bring it back', async () => {
    const { messages, waitFor } = await openSocket()
    expect(messages.find((m) => m.type === 'snapshot').vehicles).toHaveLength(1)
    const off = await driverDelete('/api/v1/driver/public-visibility')
    expect(off.statusCode).toBe(200)
    const removed = await waitFor((m) => m.type === 'vehicle.removed')
    expect(removed.vehiclePublicId).toBe(ids.bus.public_id)
    messages.length = 0
    const delayed = await traccar(fix({ fixTime: new Date(Date.now() - 120_000).toISOString() }))
    expect(delayed.statusCode).toBe(200)
    const fresh = await traccar(fix({ latitude: 40.002 }))
    expect(fresh.statusCode).toBe(200)
    await quiet()
    expect(messages.some((m) => m.type === 'vehicle.position')).toBe(false)
    const reconnect = await openSocket()
    expect(reconnect.messages.find((m) => m.type === 'snapshot').vehicles).toEqual([])
  })

  it('an expired grant removes the bus without a GPS packet and is not restored', async () => {
    const { messages, waitFor } = await openSocket()
    const exp = new Date(Date.now() + 1500).toISOString()
    expect((await driverPost('/api/v1/driver/public-visibility', { expiresAt: exp })).statusCode).toBe(201)
    await waitFor((m) => m.type === 'vehicle.position')
    await waitFor((m) => m.type === 'vehicle.removed', 6000)
    messages.length = 0
    expect((await traccar(fix({ latitude: 40.003 }))).statusCode).toBe(200)
    await quiet()
    expect(messages.some((m) => m.type === 'vehicle.position')).toBe(false)
    const reconnect = await openSocket()
    expect(reconnect.messages.find((m) => m.type === 'snapshot').vehicles).toEqual([])
  })

  it('an unexpired grant survives a server restart', async () => {
    const exp = new Date(Date.now() + 10 * 60_000).toISOString()
    expect((await driverPost('/api/v1/driver/public-visibility', { expiresAt: exp })).statusCode).toBe(201)
    await app.close()
    app = await buildApp({ config: { nodeEnv: 'test', host: '127.0.0.1', port: 0, logLevel: 'silent', databaseUrl: 'postgres://x:y@127.0.0.1:5432/busway', dbPoolMax: 1, wsExpiryCheckMs: 300 }, pool: appPool })
    await app.listen({ host: '127.0.0.1', port: 0 })
    baseUrl = `ws://127.0.0.1:${app.server.address().port}`
    const { messages } = await openSocket()
    expect(messages.find((m) => m.type === 'snapshot').vehicles).toHaveLength(1)
  })
})
