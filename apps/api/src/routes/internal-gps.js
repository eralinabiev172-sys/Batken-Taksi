import { Value } from 'typebox/value'
import Type from 'typebox'

async function ingestBusway(app, request, b) {
  const lat = b.position.latitude
  const lon = b.position.longitude
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return { status: 400, code: 'GPS_REJECTED', message: 'GPS rejected' }
  const measuredAt = new Date(b.measuredAt)
  if (Number.isNaN(measuredAt.getTime())) return { status: 400, code: 'GPS_REJECTED', message: 'GPS rejected' }
  const { rows: devRows } = await app.db.query('select id, status from gps_devices where external_id = $1', [b.deviceExternalId])
  const device = devRows[0]
  if (!device || device.status !== 'active') return { status: 404, code: 'TRACKER_UNKNOWN', message: 'Tracker unknown' }
  const { rows: asnRows } = await app.db.query(
    `select bus_id from gps_device_assignments where gps_device_id = $1 and revoked_at is null and (valid_to is null or valid_to > now()) order by valid_from desc limit 1`,
    [device.id],
  )
  if (!asnRows[0]) return { status: 409, code: 'TRACKER_NOT_ASSIGNED', message: 'Tracker not assigned' }
  const busId = asnRows[0].bus_id
  const { rows: dupRows } = await app.db.query(
    'select id from gps_positions where gps_device_id = $1 and source_position_id = $2',
    [device.id, b.gatewayPositionId],
  )
  if (dupRows[0]) return { status: 200, body: { status: 'duplicate', positionId: dupRows[0].id } }
  const { rows: tripRows } = await app.db.query(`select id from trips where bus_id = $1 and status = 'active' limit 1`, [busId])
  const tripId = tripRows[0]?.id ?? null
  const ageSec = (Date.now() - measuredAt.getTime()) / 1000
  let freshness = 'live'
  if (ageSec > 60) freshness = 'offline'
  else if (ageSec > 20) freshness = 'stale'
  else if (ageSec > 6) freshness = 'delayed'
  const { rows: posRows } = await app.db.query(
    `insert into gps_positions (source_position_id, gps_device_id, bus_id, trip_id, position, measured_at, received_at, speed_mps, heading_deg, accuracy_m, protocol_sequence, delayed, validation_status)
     values ($1,$2,$3,$4, ST_SetSRID(ST_MakePoint($6,$5),4326), $7, coalesce($8::timestamptz, now()), $9, $10, $11, $12, $13, 'accepted') returning id`,
    [b.gatewayPositionId, device.id, busId, tripId, lat, lon, measuredAt, b.receivedAt ?? null, b.speedMps ?? null, b.headingDeg ?? null, b.accuracyM ?? null, b.sequence ?? null, freshness !== 'live'],
  )
  const positionId = posRows[0].id
  const { rows: liveRows } = await app.db.query('select measured_at from vehicle_live_states where bus_id = $1', [busId])
  const current = liveRows[0]
  const updatesLive = !current || new Date(current.measured_at).getTime() < measuredAt.getTime()
  if (updatesLive) {
    await app.db.query(
      `insert into vehicle_live_states (bus_id, trip_id, gps_position_id, position, measured_at, received_at, freshness, speed_mps, heading_deg, updated_at)
       values ($1,$2,$3, ST_SetSRID(ST_MakePoint($5,$4),4326), $6, coalesce($7::timestamptz, now()), $8, $9, $10, now())
       on conflict (bus_id) do update set trip_id=excluded.trip_id, gps_position_id=excluded.gps_position_id, position=excluded.position, measured_at=excluded.measured_at, received_at=excluded.received_at, freshness=excluded.freshness, speed_mps=excluded.speed_mps, heading_deg=excluded.heading_deg, updated_at=now()
       where vehicle_live_states.measured_at < excluded.measured_at`,
      [busId, tripId, positionId, lat, lon, measuredAt, b.receivedAt ?? null, freshness, b.speedMps ?? null, b.headingDeg ?? null],
    )
  }
  // Publication is gated by the grant inside publishVehicle; ingest never enables visibility.
  // A delayed packet that did not update the live state publishes nothing.
  if (updatesLive) {
    try { await app.publishVehicle?.(busId) } catch { /* realtime is best effort; data is stored */ }
  }
  await app.db.query(
    `insert into gps_gateway_messages (device_external_id, source_position_id, processing_status, raw_hash) values ($1,$2,'accepted',$3)`,
    [b.deviceExternalId, b.gatewayPositionId, null],
  )
  return { status: 200, body: { status: 'accepted', positionId } }
}

const BuswaySchema = Type.Object({
  gatewayPositionId: Type.String({ minLength: 1 }),
  deviceExternalId: Type.String({ minLength: 1 }),
  measuredAt: Type.String({ minLength: 1 }),
  receivedAt: Type.Optional(Type.String()),
  sequence: Type.Optional(Type.String()),
  position: Type.Object({ latitude: Type.Number(), longitude: Type.Number() }, { additionalProperties: false }),
  speedMps: Type.Optional(Type.Number()),
  headingDeg: Type.Optional(Type.Number()),
  accuracyM: Type.Optional(Type.Number()),
}, { additionalProperties: false })

export default async function internalGpsRoutes(app) {
  app.post('/internal/v1/gps/positions', async (request, reply) => {
    const secret = process.env.INTERNAL_GPS_SECRET
    if (!secret || request.headers['x-gateway-secret'] !== secret) {
      reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required', requestId: request.id } })
      return
    }
    if ([...Value.Errors(BuswaySchema, request.body)].length > 0) {
      reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', requestId: request.id } })
      return
    }
    const result = await ingestBusway(app, request, request.body)
    reply.code(result.status).send(result.body || { error: { code: result.code, message: result.message, requestId: request.id } })
  })

  app.post('/internal/v1/gps/traccar', async (request, reply) => {
    const secret = process.env.INTERNAL_GPS_SECRET
    if (!secret || request.headers['x-gateway-secret'] !== secret) {
      reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required', requestId: request.id } })
      return
    }
    const payload = request.body
    const positions = Array.isArray(payload) ? payload : (payload && Array.isArray(payload.positions) ? payload.positions : [payload])
    const { traccarPositionToBusway } = await import('../lib/traccar-adapter.js')
    const converted = []
    for (const p of positions) {
      const c = traccarPositionToBusway(p)
      if (!c) {
        reply.code(400).send({ error: { code: 'GPS_REJECTED', message: 'GPS rejected', requestId: request.id } })
        return
      }
      // server-side trusted mapping: traccar deviceId -> registered gps_device (by traccar_device_id)
      const { rows: devRows } = await app.db.query('select external_id, status from gps_devices where traccar_device_id = $1', [Number(c.traccarDeviceId)])
      if (!devRows[0] || devRows[0].status !== 'active') {
        reply.code(404).send({ error: { code: 'TRACKER_UNKNOWN', message: 'Tracker unknown', requestId: request.id } })
        return
      }
      const busway = { ...c }
      delete busway.traccarDeviceId
      busway.deviceExternalId = devRows[0].external_id
      if ([...Value.Errors(BuswaySchema, busway)].length > 0) {
        reply.code(400).send({ error: { code: 'GPS_REJECTED', message: 'GPS rejected', requestId: request.id } })
        return
      }
      converted.push(busway)
    }
    const results = []
    for (const c of converted) {
      const r = await ingestBusway(app, request, c)
      results.push(r)
    }
    const hasError = results.some((r) => r.status >= 400)
    reply.code(hasError ? 207 : 200).send({ results })
  })
}