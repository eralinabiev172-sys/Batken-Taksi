import websocket from '@fastify/websocket'

export async function registerWebsocket(app) {
  await app.register(websocket)
  app.get('/ws/v1/live', { websocket: true }, (socket, _request) => {
    socket.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString())
        if (msg?.type === 'ping') socket.send(JSON.stringify({ type: 'pong' }))
      } catch { /* ignore */ }
    })
    // send initial snapshot (public vehicles with valid grant)
    ;(async () => {
      try {
        const { rows } = await app.db.query(
          `select v.bus_id, v.position, v.measured_at, v.freshness, v.speed_mps, v.heading_deg
             from vehicle_live_states v
             where exists (select 1 from public_visibility_grants g
                            where g.bus_id = v.bus_id and g.disabled_at is null and g.expires_at > now())`,
        )
        socket.send(JSON.stringify({ type: 'snapshot', vehicles: rows }))
      } catch {
        socket.send(JSON.stringify({ type: 'error', code: 'INTERNAL_ERROR' }))
      }
    })()
    socket.on('close', () => {})
  })
}