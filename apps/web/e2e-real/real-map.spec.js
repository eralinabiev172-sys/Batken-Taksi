import { execFileSync } from 'node:child_process'
import { randomInt } from 'node:crypto'
import pg from 'pg'
import { expect, test } from '@playwright/test'
import { hashPassword } from '../../api/src/lib/password.js'
import { newPublicId } from '../../api/src/lib/ids.js'

// Passenger map against the REAL API and a disposable PostgreSQL. Synthetic data only; every row is
// removed afterwards. The browser never receives demo data: the app runs with VITE_USE_REAL_API=true.
const API = 'http://127.0.0.1:3001'
const SECRET = 'browser-e2e-gateway-secret'
const PASSWORD = 'e2e-driver-password'
const MARKERS = 'svg.leaflet-zoom-animated path.leaflet-interactive' // endpoints first, then buses
const busCards = (page) => page.locator('.bus-list .bus-card')

test.describe.configure({ mode: 'serial' })

test.describe('passenger map with the real API', () => {
  const tag = `br${randomInt(1e9)}`
  const ids = {}
  let admin, cookie, csrf, clock

  const api = (path, init = {}) => fetch(`${API}${path}`, init)
  const driver = (path, method, body) => api(path, {
    method,
    headers: { 'content-type': 'application/json', cookie, 'x-csrf-token': csrf },
    body: body ? JSON.stringify(body) : '{}',
  })
  const enableGrant = (ms) => driver('/api/v1/driver/public-visibility', 'POST', { expiresAt: new Date(Date.now() + ms).toISOString() })
  const disableGrant = () => driver('/api/v1/driver/public-visibility', 'DELETE')
  async function gps({ speedMps = 10, ageMs = 0 } = {}) {
    clock += 1
    const measured = new Date(Date.now() - ageMs + clock % 1000)
    const res = await api('/internal/v1/gps/positions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-gateway-secret': SECRET },
      body: JSON.stringify({
        gatewayPositionId: `${tag}-${clock}`, deviceExternalId: `${tag}-dev`, measuredAt: measured.toISOString(),
        position: { latitude: 40.0, longitude: 70.88 }, speedMps,
      }),
    })
    expect(res.status).toBe(200)
  }

  test.beforeAll(async () => {
    const ports = JSON.parse(execFileSync('docker', ['inspect', 'busway-test-postgres-iso', '--format', '{{json .HostConfig.PortBindings}}'], { encoding: 'utf8' }))
    const b = ports['5432/tcp']?.[0]
    if (!b || b.HostIp !== '127.0.0.1' || b.HostPort !== '55433') throw new Error('isolated DB identity check failed')
    admin = new pg.Pool({ host: '127.0.0.1', port: 55433, database: 'busway_test', user: 'busway_admin', password: 'iso-admin-pw', ssl: false, max: 2 })
    const q = async (sql, params) => (await admin.query(sql, params)).rows[0]
    clock = 0

    ids.city = (await q('insert into cities(public_id,name_ru,name_ky) values ($1,$2,$2) returning id', [newPublicId('city'), `${tag} c`])).id
    ids.route = await q(`insert into routes(city_id,public_number,name_ru,name_ky) values ($1,'1','Кара-Булак — Баткен','Кара-Булак — Баткен') returning id`, [ids.city])
    ids.dirA = await q(`insert into route_directions(route_id,name_ru,name_ky) values ($1,'Кара-Булак → Баткен','Кара-Булак → Баткен') returning id`, [ids.route.id])
    ids.dirB = await q(`insert into route_directions(route_id,name_ru,name_ky) values ($1,'Баткен → Кара-Булак','Баткен → Кара-Булак') returning id`, [ids.route.id])
    ids.school = await q(`insert into stops(city_id,name_ru,name_ky,location) values ($1,'Школа имени С. Эрматова','С. Эрматов атындагы мектеп', ST_SetSRID(ST_MakePoint(70.93038,39.94157),4326)::geography) returning id`, [ids.city])
    ids.station = await q(`insert into stops(city_id,name_ru,name_ky,location) values ($1,'Баткенский автовокзал','Баткен автобекети', ST_SetSRID(ST_MakePoint(70.825903,40.057595),4326)::geography) returning id`, [ids.city])
    await admin.query('insert into route_stops(direction_id,stop_id,sequence) values ($1,$2,1),($1,$3,2)', [ids.dirA.id, ids.school.id, ids.station.id])
    await admin.query('insert into route_stops(direction_id,stop_id,sequence) values ($1,$2,1),($1,$3,2)', [ids.dirB.id, ids.station.id, ids.school.id])
    ids.bus = await q('insert into buses(city_id,internal_number) values ($1,$2) returning id', [ids.city, tag])
    ids.email = `${tag}@example.test`
    ids.driver = (await q('insert into users(public_id,email,password_hash) values ($1,$2,$3) returning id', [newPublicId('usr'), ids.email, await hashPassword(PASSWORD)])).id
    await admin.query("insert into user_roles(user_id,role) values ($1,'driver')", [ids.driver])
    ids.device = (await q("insert into gps_devices(external_id,status) values ($1,'active') returning id", [`${tag}-dev`])).id
    await admin.query('insert into gps_device_assignments(gps_device_id,bus_id,created_by) values ($1,$2,$3)', [ids.device, ids.bus.id, ids.driver])
    await admin.query('insert into driver_bus_assignments(driver_user_id,bus_id,created_by) values ($1,$2,$1)', [ids.driver, ids.bus.id])

    const login = await api('/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: ids.email, password: PASSWORD }) })
    expect(login.status).toBe(200)
    const cookies = login.headers.getSetCookie().map((c) => c.split(';')[0])
    cookie = cookies.join('; ')
    csrf = cookies.find((c) => c.startsWith('csrf=')).slice(5)
  })

  test.afterAll(async () => {
    if (admin && ids.city) {
      await admin.query('delete from gps_gateway_messages where device_external_id = $1', [`${tag}-dev`])
      await admin.query('delete from vehicle_live_states where bus_id = $1', [ids.bus.id])
      await admin.query('delete from gps_positions where bus_id = $1', [ids.bus.id])
      await admin.query('delete from public_visibility_grants where bus_id = $1', [ids.bus.id])
      await admin.query('delete from gps_device_assignments where bus_id = $1', [ids.bus.id])
      await admin.query('delete from driver_bus_assignments where bus_id = $1', [ids.bus.id])
      await admin.query('delete from gps_devices where id = $1', [ids.device])
      await admin.query('delete from buses where id = $1', [ids.bus.id])
      await admin.query('delete from route_stops where direction_id = any($1::uuid[])', [[ids.dirA.id, ids.dirB.id]])
      await admin.query('delete from stops where id = any($1::uuid[])', [[ids.school.id, ids.station.id]])
      await admin.query('delete from route_directions where route_id = $1', [ids.route.id])
      await admin.query('delete from routes where id = $1', [ids.route.id])
      await admin.query('delete from sessions where user_id = $1', [ids.driver])
      await admin.query('delete from user_roles where user_id = $1', [ids.driver])
      await admin.query('delete from users where id = $1', [ids.driver])
      await admin.query('delete from cities where id = $1', [ids.city])
    }
    await admin?.end()
  })

  test('loads the real route and shows no buses and no demo banner without a grant', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('.route-summary')).toContainText('Кара-Булак — Баткен')
    await expect(page.getByTestId('demo-banner')).toHaveCount(0)
    await expect(page.locator('.bus-list .section-title-row > span')).toHaveText('0/3')
    await expect(page.locator('.empty-state')).toBeVisible()
    await expect(page.locator(MARKERS)).toHaveCount(2) // the two approved endpoints; no route line is drawn
    await expect(page.locator('.map-source')).not.toContainText('Демо')
  })

  test('a GPS fix with an active grant puts the bus on the map; the next fix updates it live', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('.empty-state')).toBeVisible()
    expect((await enableGrant(10 * 60_000)).status).toBe(201)
    await gps({ speedMps: 10 })
    await expect(busCards(page)).toHaveCount(1, { timeout: 10_000 })
    await expect(busCards(page).first()).toContainText('36')
    await expect(page.locator(MARKERS)).toHaveCount(3)
    await gps({ speedMps: 0 })
    await expect(busCards(page).first()).not.toContainText('36', { timeout: 10_000 })
    await expect(busCards(page)).toHaveCount(1)
  })

  test('manual disable removes the bus from an open page; late and fresh fixes do not bring it back', async ({ page }) => {
    await page.goto('/')
    await expect(busCards(page)).toHaveCount(1, { timeout: 10_000 })
    expect((await disableGrant()).status).toBe(200)
    await expect(busCards(page)).toHaveCount(0, { timeout: 10_000 })
    await expect(page.locator(MARKERS)).toHaveCount(2)
    await gps({ ageMs: 10 * 60_000 })
    await gps({})
    await page.waitForTimeout(1500)
    await expect(busCards(page)).toHaveCount(0)
    await page.reload()
    await expect(page.locator('.route-summary')).toBeVisible()
    await expect(busCards(page)).toHaveCount(0)
  })

  test('an expired grant removes the bus without any new GPS packet', async ({ page }) => {
    await gps({})
    expect((await enableGrant(4000)).status).toBe(201)
    await page.goto('/')
    await expect(busCards(page)).toHaveCount(1, { timeout: 10_000 })
    await expect(busCards(page)).toHaveCount(0, { timeout: 15_000 })
    await expect(page.locator('.empty-state')).toBeVisible()
  })
})
