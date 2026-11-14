import { Value } from 'typebox/value'
import Type from 'typebox'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function isUuid(v) { return typeof v === 'string' && UUID_RE.test(v) }
function bad(reply, request) { reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', requestId: request.id } }) }
function notFound(reply, request) { reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Not found', requestId: request.id } }) }

export default async function adminAssignmentsRoutes(app) {
  const admin = (permission, handler) => app.requirePermission(permission, async (request, reply) => {
    if (!request.session?.roles?.includes('admin')) {
      reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden', requestId: request.id } }); return
    }
    try {
      return await handler(request, reply)
    } catch (err) {
      const code = err && typeof err === 'object' ? err.code : undefined
      if (code === '23503' || code === '23505' || code === '23P01') {
        reply.code(409).send({ error: { code: 'CONFLICT', message: 'Conflict', requestId: request.id } })
        return
      }
      throw err
    }
  })

  // --- driver-bus assignments ---
  app.get('/admin/driver-assignments', admin('assignments.manage', async (request, reply) => {
    const { driverId, busId, active } = request.query || {}
    const params = []
    let sql = 'select * from driver_bus_assignments where true'
    if (driverId) { if (!isUuid(driverId)) { bad(reply, request); return }; sql += ` and driver_user_id = $${params.push(driverId)}` }
    if (busId) { if (!isUuid(busId)) { bad(reply, request); return }; sql += ` and bus_id = $${params.push(busId)}` }
    if (active === 'true') sql += ' and revoked_at is null and (valid_to is null or valid_to > now())'
    sql += ' order by valid_from desc'
    const { rows } = await app.db.query(sql, params)
    reply.send({ assignments: rows })
  }))

  app.post('/admin/driver-assignments', admin('assignments.manage', async (request, reply) => {
    const s = Type.Object({ driverUserId: Type.String(), busId: Type.String(), validFrom: Type.Optional(Type.String()), validTo: Type.Optional(Type.String()) }, { additionalProperties: false })
    if ([...Value.Errors(s, request.body)].length > 0) { bad(reply, request); return }
    const b = request.body
    if (!isUuid(b.driverUserId) || !isUuid(b.busId)) { bad(reply, request); return }
    const { rows } = await app.db.query(
      `insert into driver_bus_assignments (driver_user_id, bus_id, valid_from, valid_to, created_by) values ($1,$2,coalesce($3::timestamptz, now()), $4::timestamptz, $5) returning *`,
      [b.driverUserId, b.busId, b.validFrom ?? null, b.validTo ?? null, request.session.userId],
    )
    reply.code(201).send({ assignment: rows[0] })
  }))

  app.post('/admin/driver-assignments/:id/revoke', admin('assignments.manage', async (request, reply) => {
    if (!isUuid(request.params.id)) { bad(reply, request); return }
    const s = Type.Object({ reason: Type.Optional(Type.String()) }, { additionalProperties: false })
    if (request.body && [...Value.Errors(s, request.body)].length > 0) { bad(reply, request); return }
    const { rows } = await app.db.query(
      `update driver_bus_assignments set revoked_at = now(), revoked_reason = $2, valid_to = coalesce(valid_to, now()) where id = $1 and revoked_at is null returning *`,
      [request.params.id, request.body?.reason ?? 'revoked'],
    )
    if (!rows[0]) { notFound(reply, request); return }
    reply.send({ assignment: rows[0] })
  }))

  app.get('/admin/driver-assignments/:id', admin('assignments.manage', async (request, reply) => {
    if (!isUuid(request.params.id)) { bad(reply, request); return }
    const { rows } = await app.db.query('select * from driver_bus_assignments where id = $1', [request.params.id])
    if (!rows[0]) { notFound(reply, request); return }
    reply.send({ assignment: rows[0] })
  }))

  // --- gps devices ---
  app.get('/admin/gps-devices', admin('devices.manage', async (request, reply) => {
    const { rows } = await app.db.query('select id, public_id, external_id, manufacturer, model, order_code, serial_number, protocol, firmware, auth_mode, status, last_seen_at, archived_at, created_at, updated_at from gps_devices order by created_at desc')
    reply.send({ gpsDevices: rows })
  }))

  app.post('/admin/gps-devices', admin('devices.manage', async (request, reply) => {
    const s = Type.Object({ externalId: Type.String({ minLength: 1 }), traccarDeviceId: Type.Optional(Type.Integer({ minimum: 1 })), manufacturer: Type.Optional(Type.String()), model: Type.Optional(Type.String()), orderCode: Type.Optional(Type.String()), serialNumber: Type.Optional(Type.String()), protocol: Type.Optional(Type.String()), firmware: Type.Optional(Type.String()), authMode: Type.Optional(Type.String()) }, { additionalProperties: false })
    if ([...Value.Errors(s, request.body)].length > 0) { bad(reply, request); return }
    const b = request.body
    const { rows } = await app.db.query(
      `insert into gps_devices (external_id, traccar_device_id, manufacturer, model, order_code, serial_number, protocol, firmware, auth_mode) values ($1,$2,$3,$4,$5,$6,$7,$8,coalesce($9,'per_device_secret')) returning *`,
      [b.externalId, b.traccarDeviceId ?? null, b.manufacturer ?? null, b.model ?? null, b.orderCode ?? null, b.serialNumber ?? null, b.protocol ?? null, b.firmware ?? null, b.authMode ?? null],
    )
    reply.code(201).send({ gpsDevice: rows[0] })
  }))

  app.patch('/admin/gps-devices/:id', admin('devices.manage', async (request, reply) => {
    if (!isUuid(request.params.id)) { bad(reply, request); return }
    const s = Type.Object({ manufacturer: Type.Optional(Type.Union([Type.String(), Type.Null()])), model: Type.Optional(Type.Union([Type.String(), Type.Null()])), firmware: Type.Optional(Type.Union([Type.String(), Type.Null()])), status: Type.Optional(Type.String()), authMode: Type.Optional(Type.String()), traccarDeviceId: Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), Type.Null()])) }, { additionalProperties: false })
    if ([...Value.Errors(s, request.body)].length > 0) { bad(reply, request); return }
    const b = request.body
    const { rows } = await app.db.query(
      `update gps_devices set
        manufacturer = case when $2::boolean then $3 else manufacturer end,
        model = case when $4::boolean then $5 else model end,
        firmware = case when $6::boolean then $7 else firmware end,
        status = coalesce($8, status),
        auth_mode = coalesce($9, auth_mode),
        traccar_device_id = case when $10::boolean then $11 else traccar_device_id end,
        updated_at = now()
       where id = $1 returning *`,
      [request.params.id, b.manufacturer !== undefined, b.manufacturer ?? null, b.model !== undefined, b.model ?? null, b.firmware !== undefined, b.firmware ?? null, b.status ?? null, b.authMode ?? null, b.traccarDeviceId !== undefined, b.traccarDeviceId ?? null],
    )
    if (!rows[0]) { notFound(reply, request); return }
    reply.send({ gpsDevice: rows[0] })
  }))

  app.post('/admin/gps-devices/:id/archive', admin('devices.manage', async (request, reply) => {
    if (!isUuid(request.params.id)) { bad(reply, request); return }
    const { rows } = await app.db.query('update gps_devices set status = $2, archived_at = now(), updated_at = now() where id = $1 and archived_at is null returning *', [request.params.id, 'archived'])
    if (!rows[0]) { notFound(reply, request); return }
    reply.send({ gpsDevice: rows[0] })
  }))

  // --- gps device assignments ---
  app.get('/admin/gps-device-assignments', admin('devices.manage', async (request, reply) => {
    const { deviceId, busId, active } = request.query || {}
    const params = []
    let sql = 'select * from gps_device_assignments where true'
    if (deviceId) { if (!isUuid(deviceId)) { bad(reply, request); return }; sql += ` and gps_device_id = $${params.push(deviceId)}` }
    if (busId) { if (!isUuid(busId)) { bad(reply, request); return }; sql += ` and bus_id = $${params.push(busId)}` }
    if (active === 'true') sql += ' and revoked_at is null and (valid_to is null or valid_to > now())'
    sql += ' order by valid_from desc'
    const { rows } = await app.db.query(sql, params)
    reply.send({ assignments: rows })
  }))

  app.post('/admin/gps-device-assignments', admin('devices.manage', async (request, reply) => {
    const s = Type.Object({ gpsDeviceId: Type.String(), busId: Type.String(), validFrom: Type.Optional(Type.String()), validTo: Type.Optional(Type.String()), reason: Type.Optional(Type.String()) }, { additionalProperties: false })
    if ([...Value.Errors(s, request.body)].length > 0) { bad(reply, request); return }
    const b = request.body
    if (!isUuid(b.gpsDeviceId) || !isUuid(b.busId)) { bad(reply, request); return }
    const { rows } = await app.db.query(
      `insert into gps_device_assignments (gps_device_id, bus_id, valid_from, valid_to, reason, created_by) values ($1,$2,coalesce($3::timestamptz, now()), $4::timestamptz, $5, $6) returning *`,
      [b.gpsDeviceId, b.busId, b.validFrom ?? null, b.validTo ?? null, b.reason ?? null, request.session.userId],
    )
    reply.code(201).send({ assignment: rows[0] })
  }))

  app.post('/admin/gps-device-assignments/:id/revoke', admin('devices.manage', async (request, reply) => {
    if (!isUuid(request.params.id)) { bad(reply, request); return }
    const s = Type.Object({ reason: Type.Optional(Type.String()) }, { additionalProperties: false })
    if (request.body && [...Value.Errors(s, request.body)].length > 0) { bad(reply, request); return }
    const { rows } = await app.db.query(
      `update gps_device_assignments set revoked_at = now(), revoked_reason = $2, valid_to = coalesce(valid_to, now()) where id = $1 and revoked_at is null returning *`,
      [request.params.id, request.body?.reason ?? 'revoked'],
    )
    if (!rows[0]) { notFound(reply, request); return }
    reply.send({ assignment: rows[0] })
  }))

  app.get('/admin/gps-device-assignments/:id', admin('devices.manage', async (request, reply) => {
    if (!isUuid(request.params.id)) { bad(reply, request); return }
    const { rows } = await app.db.query('select * from gps_device_assignments where id = $1', [request.params.id])
    if (!rows[0]) { notFound(reply, request); return }
    reply.send({ assignment: rows[0] })
  }))
}
