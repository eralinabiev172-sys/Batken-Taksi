import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { buildApp } from '../../src/app.js'

const config = { nodeEnv: 'test', host: '127.0.0.1', port: 0, logLevel: 'silent', databaseUrl: 'postgres://u:p@127.0.0.1:1/none', dbPoolMax: 1 }
const apps = []
afterEach(async () => { while (apps.length) await apps.pop().close() })

function makePool(rows = []) {
  return { on() {}, end: async () => {}, query: async (sql) => {
    if (/from vehicle_live_states/i.test(sql)) return { rows }
    return { rows: [] }
  } }
}

describe('WebSocket E2E (3.2.7)', () => {
  it('connects and receives snapshot', async () => {
    const app = await buildApp({ config, pool: makePool([{ bus_id: 'b1', measured_at: new Date(), freshness: 'live' }]) })
    apps.push(app)
    await app.listen({ host: '127.0.0.1', port: 0 })
    const port = app.server.address().port
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/v1/live`)
    const msg = await new Promise((resolve, reject) => {
      ws.on('message', (d) => resolve(JSON.parse(d.toString())))
      ws.on('error', reject)
      setTimeout(() => reject(new Error('timeout')), 5000)
    })
    expect(msg.type).toBe('snapshot')
    expect(Array.isArray(msg.vehicles)).toBe(true)
    ws.close()
  })
  it('ping -> pong', async () => {
    const app = await buildApp({ config, pool: makePool([]) })
    apps.push(app)
    await app.listen({ host: '127.0.0.1', port: 0 })
    const port = app.server.address().port
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/v1/live`)
    await new Promise((r) => ws.on('open', r))
    ws.send(JSON.stringify({ type: 'ping' }))
    const msg = await new Promise((resolve, reject) => {
      ws.on('message', (d) => { const m = JSON.parse(d.toString()); if (m.type === 'pong') resolve(m) })
      setTimeout(() => reject(new Error('timeout')), 5000)
    })
    expect(msg.type).toBe('pong')
    ws.close()
    await new Promise((r) => setTimeout(r, 50))
  })
})