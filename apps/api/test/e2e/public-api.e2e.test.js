import { execFileSync } from 'node:child_process'
import { randomInt } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.js'
import { newPublicId } from '../../src/lib/ids.js'

// Public read-only API against the disposable test database. Synthetic data; rows are removed after.
const enabled = process.env.BUSWAY_E2E_ISO === '1'
const run = enabled ? describe : describe.skip

function assertIsolated() {
  const ports = JSON.parse(execFileSync('docker', ['inspect', 'busway-test-postgres-iso', '--format', '{{json .HostConfig.PortBindings}}'], { encoding: 'utf8' }))
  const b = ports['5432/tcp']?.[0]
  if (!b || b.HostIp !== '127.0.0.1' || b.HostPort !== '55433') throw new Error('isolated DB identity check failed')
}

run('public API: routes and live vehicles', () => {
  const tag = `pub${randomInt(1e9)}`
  const ids = {}
  let admin, appPool, app
  const get = (url) => app.inject({ method: 'GET', url })

  beforeAll(async () => {
    assertIsolated()
    admin = new pg.Pool({ host: '127.0.0.1', port: 55433, database: 'busway_test', user: 'busway_admin', password: 'iso-admin-pw', ssl: false, max: 2 })
    appPool = new pg.Pool({ host: '127.0.0.1', port: 55433, database: 'busway_test', user: 'busway_app', password: 'iso-app-pw', ssl: false, max: 4 })
    const q = async (sql, params) => (await admin.query(sql, params)).rows[0]

    ids.city = (await q('insert into cities(public_id,name_ru,name_ky) values ($1,$2,$2) returning id', [newPublicId('city'), `${tag} c`])).id
    ids.route = await q(`insert into routes(city_id,public_number,name_ru,name_ky) values ($1,$2,'Кара-Булак — Баткен','Кара-Булак — Баткен') returning id, public_id`, [ids.city, tag])
    ids.dirA = await q(`insert into route_directions(route_id,name_ru,name_ky) values ($1,'Кара-Булак → Баткен','Кара-Булак → Баткен') returning id, public_id`, [ids.route.id])
    ids.dirB = await q(`insert into route_directions(route_id,name_ru,name_ky) values ($1,'Баткен → Кара-Булак','Баткен → Кара-Булак') returning id, public_id`, [ids.route.id])
    // Approved endpoints only (D-126). Synthetic copies are used so the test owns and removes them.
    ids.school = await q(`insert into stops(city_id,name_ru,name_ky,location) values ($1,'Школа имени С. Эрматова','С. Эрматов атындагы мектеп', ST_SetSRID(ST_MakePoint(70.93038,39.94157),4326)::geography) returning id, public_id`, [ids.city])
    ids.station = await q(`insert into stops(city_id,name_ru,name_ky,location) values ($1,'Баткенский автовокзал','Баткен автобекети', ST_SetSRID(ST_MakePoint(70.825903,40.057595),4326)::geography) returning id, public_id`, [ids.city])
    await admin.query('insert into route_stops(direction_id,stop_id,sequence) values ($1,$2,1),($1,$3,2)', [ids.dirA.id, ids.school.id, ids.station.id])
    await admin.query('insert into route_stops(direction_id,stop_id,sequence) values ($1,$2,1),($1,$3,2)', [ids.dirB.id, ids.station.id, ids.school.id])

    ids.bus = await q('insert into buses(city_id,internal_number) values ($1,$2) returning id, public_id', [ids.city, tag])
    ids.driver = (await q('insert into users(public_id,email,password_hash) values ($1,$2,$3) returning id', [newPublicId('usr'), `${tag}@example.test`, 'x'])).id
    ids.assignment = (await q('insert into driver_bus_assignments(driver_user_id,bus_id,created_by) values ($1,$2,$1) returning id', [ids.driver, ids.bus.id])).id
    await admin.query(`insert into vehicle_live_states(bus_id,position,measured_at,received_at,freshness,speed_mps,heading_deg)
                       values ($1, ST_SetSRID(ST_MakePoint(70.9,40.0),4326), now() - interval '3 seconds', now(), 'live', 0, 90)`, [ids.bus.id])

    app = await buildApp({ config: { nodeEnv: 'test', host: '127.0.0.1', port: 0, logLevel: 'silent', databaseUrl: 'postgres://x:y@127.0.0.1:5432/busway', dbPoolMax: 1 }, pool: appPool })
  })

  afterAll(async () => {
    if (app) await app.close()
    if (admin && ids.city) {
      await admin.query('delete from public_visibility_grants where bus_id = $1', [ids.bus.id])
      await admin.query('delete from trips where bus_id = $1', [ids.bus.id])
      await admin.query('delete from vehicle_live_states where bus_id = $1', [ids.bus.id])
      await admin.query('delete from driver_bus_assignments where bus_id = $1', [ids.bus.id])
      await admin.query('delete from buses where id = $1', [ids.bus.id])
      await admin.query('delete from route_stops where direction_id = any($1::uuid[])', [[ids.dirA.id, ids.dirB.id]])
      await admin.query('delete from stops where id = any($1::uuid[])', [[ids.school.id, ids.station.id]])
      await admin.query('delete from route_directions where route_id = $1', [ids.route.id])
      await admin.query('delete from routes where id = $1', [ids.route.id])
      await admin.query('delete from users where id = $1', [ids.driver])
      await admin.query('delete from cities where id = $1', [ids.city])
    }
    await appPool?.end()
    await admin?.end()
  })

  it('GET /routes works without a session and returns public ids only', async () => {
    const res = await get('/api/v1/routes')
    expect(res.statusCode).toBe(200)
    const route = res.json().routes.find((r) => r.id === ids.route.public_id)
    expect(route.number).toBe(tag)
    expect(route.name.ru).toBe('Кара-Булак — Баткен')
    expect(route.directions).toHaveLength(2)
    expect(route.stops).toHaveLength(2)
    expect(route.stops.every((s) => s.kind === 'terminal')).toBe(true)
    const school = route.stops.find((s) => s.id === ids.school.public_id)
    expect(school.position[0]).toBeCloseTo(39.94157, 5)
    expect(school.position[1]).toBeCloseTo(70.93038, 5)
    const dir = route.directions.find((d) => d.id === ids.dirA.public_id)
    expect(dir.originStopId).toBe(ids.school.public_id)
    expect(dir.destinationStopId).toBe(ids.station.public_id)
    // No geometry is invented: pending directions have no path.
    expect(dir.path).toBeNull()
    expect(route.geometryStatus).toBe('pendingConfirmation')
    for (const internal of [ids.route.id, ids.dirA.id, ids.school.id, ids.city]) expect(res.body).not.toContain(internal)
  })

  it('GET /vehicles/live hides a bus without a grant, even though a live state exists', async () => {
    const res = await get('/api/v1/vehicles/live')
    expect(res.statusCode).toBe(200)
    expect(res.json().vehicles.some((v) => v.vehiclePublicId === ids.bus.public_id)).toBe(false)
  })

  it('shows the bus with an active grant, with route context only from an active trip', async () => {
    await admin.query(`insert into public_visibility_grants(driver_assignment_id,driver_user_id,bus_id,expires_at)
                       values ($1,$2,$3, now() + interval '10 minutes')`, [ids.assignment, ids.driver, ids.bus.id])
    let v = (await get('/api/v1/vehicles/live')).json().vehicles.find((x) => x.vehiclePublicId === ids.bus.public_id)
    expect(v).toBeDefined()
    expect(v.latitude).toBeCloseTo(40.0, 5)
    expect(v.ageSeconds).toBeGreaterThanOrEqual(3)
    expect(v.ageSeconds).toBeLessThan(15)
    expect(v.routeId).toBeNull()
    expect(JSON.stringify(v)).not.toContain(ids.bus.id)
    expect(Object.keys(v).sort()).toEqual(['ageSeconds', 'directionId', 'freshness', 'headingDeg', 'latitude', 'longitude', 'measuredAt', 'routeId', 'speedMps', 'vehiclePublicId'])

    await admin.query(`insert into trips(driver_assignment_id,driver_user_id,bus_id,route_direction_id) values ($1,$2,$3,$4)`, [ids.assignment, ids.driver, ids.bus.id, ids.dirB.id])
    v = (await get('/api/v1/vehicles/live')).json().vehicles.find((x) => x.vehiclePublicId === ids.bus.public_id)
    expect(v.routeId).toBe(ids.route.public_id)
    expect(v.directionId).toBe(ids.dirB.public_id)

    // Completing the trip removes only the route context; the bus stays visible (D-127).
    await admin.query(`update trips set status='completed', ended_at=now() where bus_id=$1`, [ids.bus.id])
    v = (await get('/api/v1/vehicles/live')).json().vehicles.find((x) => x.vehiclePublicId === ids.bus.public_id)
    expect(v).toBeDefined()
    expect(v.routeId).toBeNull()
  })

  it('hides the bus again as soon as the grant is disabled or expired', async () => {
    await admin.query(`update public_visibility_grants set disabled_at = now(), disabled_reason = 'manual' where bus_id = $1`, [ids.bus.id])
    expect((await get('/api/v1/vehicles/live')).json().vehicles.some((x) => x.vehiclePublicId === ids.bus.public_id)).toBe(false)
    await admin.query(`insert into public_visibility_grants(driver_assignment_id,driver_user_id,bus_id,enabled_at,expires_at)
                       values ($1,$2,$3, now() - interval '2 minutes', now() - interval '1 minute')`, [ids.assignment, ids.driver, ids.bus.id])
    expect((await get('/api/v1/vehicles/live')).json().vehicles.some((x) => x.vehiclePublicId === ids.bus.public_id)).toBe(false)
  })
})
