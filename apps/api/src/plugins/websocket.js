import websocket from '@fastify/websocket'
import { VISIBLE_SQL, toPublicVehicle } from '../lib/public-vehicles.js'

// The grant is re-checked on every snapshot, every publish and by a periodic sweep, so expiry
// removes a vehicle even if no GPS packet arrives. Trips are not consulted for visibility.
export async function registerWebsocket(app, { expiryCheckMs = 5000 } = {}) {
  await app.register(websocket)
  const clients = new Set()
  const announced = new Map() // internal bus id -> public id, for vehicle.removed

  const broadcast = (message) => {
    const text = JSON.stringify(message)
    for (const socket of clients) if (socket.readyState === 1) socket.send(text)
  }

  async function publishVehicle(busId) {
    const { rows } = await app.db.query(`${VISIBLE_SQL} and v.bus_id = $1`, [busId])
    if (rows[0]) {
      announced.set(busId, rows[0].vehicle_public_id)
      broadcast({ type: 'vehicle.position', vehicle: toPublicVehicle(rows[0]) })
    } else if (announced.has(busId)) {
      broadcast({ type: 'vehicle.removed', vehiclePublicId: announced.get(busId) })
      announced.delete(busId)
    }
  }

  async function sweep() {
    if (announced.size === 0) return
    const ids = [...announced.keys()]
    const { rows } = await app.db.query(`${VISIBLE_SQL} and v.bus_id = any($1::uuid[])`, [ids])
    const stillVisible = new Set(rows.map((r) => r.bus_id))
    for (const id of ids) {
      if (!stillVisible.has(id)) {
        broadcast({ type: 'vehicle.removed', vehiclePublicId: announced.get(id) })
        announced.delete(id)
      }
    }
  }

  app.decorate('publishVehicle', publishVehicle)
  const timer = setInterval(() => { sweep().catch(() => {}) }, expiryCheckMs)
  timer.unref()
  app.addHook('onClose', async () => { clearInterval(timer) })

  app.get('/ws/v1/live', { websocket: true }, (socket, _request) => {
    clients.add(socket)
    socket.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString())
        if (msg?.type === 'ping') socket.send(JSON.stringify({ type: 'pong' }))
      } catch { /* ignore */ }
    })
    socket.on('close', () => { clients.delete(socket) })
    ;(async () => {
      try {
        const { rows } = await app.db.query(VISIBLE_SQL)
        for (const r of rows) announced.set(r.bus_id, r.vehicle_public_id)
        socket.send(JSON.stringify({ type: 'snapshot', vehicles: rows.map(toPublicVehicle) }))
      } catch {
        socket.send(JSON.stringify({ type: 'error', code: 'INTERNAL_ERROR' }))
      }
    })()
  })
}
