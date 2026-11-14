import { Value } from 'typebox/value'
import Type from 'typebox'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function isUuid(v) { return typeof v === 'string' && UUID_RE.test(v) }

function bad(reply, request, code = 'VALIDATION_ERROR', msg = 'Request validation failed') {
  reply.code(400).send({ error: { code, message: msg, requestId: request.id } })
}

export default async function adminFleetRoutes(app) {
  const admin = (permission, handler) => app.requirePermission(permission, async (request, reply) => {
    if (!request.session?.roles?.includes('admin')) {
      reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden', requestId: request.id } })
      return
    }
    return handler(request, reply)
  })

  // --- buses ---
  app.get('/admin/buses', admin('fleet.manage', async (request, reply) => {
    const { rows } = await app.db.query('select id, public_id, city_id, internal_number, plate_number, make, model, capacity, status, archived_at, created_at, updated_at from buses order by created_at desc')
    reply.send({ buses: rows })
  }))

  app.post('/admin/buses', admin('fleet.manage', async (request, reply) => {
    const s = Type.Object({ cityId: Type.String(), internalNumber: Type.String({ minLength: 1 }), plateNumber: Type.Optional(Type.String()), make: Type.Optional(Type.String()), model: Type.Optional(Type.String()), capacity: Type.Optional(Type.Integer({ minimum: 1 })) }, { additionalProperties: false })
    if (![...Value.Errors(s, request.body)].length === 0 ? false : [...Value.Errors(s, request.body)].length > 0) {
      bad(reply, request); return
    }
    const b = request.body
    if (!isUuid(b.cityId)) { bad(reply, request); return }
    const { rows } = await app.db.query(
      `insert into buses (city_id, internal_number, plate_number, make, model, capacity) values ($1,$2,$3,$4,$5,$6) returning *`,
      [b.cityId, b.internalNumber, b.plateNumber ?? null, b.make ?? null, b.model ?? null, b.capacity ?? null],
    )
    reply.code(201).send({ bus: rows[0] })
  }))

  app.get('/admin/buses/:id', admin('fleet.manage', async (request, reply) => {
    if (!isUuid(request.params.id)) { bad(reply, request); return }
    const { rows } = await app.db.query('select * from buses where id = $1', [request.params.id])
    if (!rows[0]) { reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Not found', requestId: request.id } }); return }
    reply.send({ bus: rows[0] })
  }))

  app.patch('/admin/buses/:id', admin('fleet.manage', async (request, reply) => {
    if (!isUuid(request.params.id)) { bad(reply, request); return }
    const s = Type.Object({ internalNumber: Type.Optional(Type.String({ minLength: 1 })), plateNumber: Type.Optional(Type.Union([Type.String(), Type.Null()])), make: Type.Optional(Type.Union([Type.String(), Type.Null()])), model: Type.Optional(Type.Union([Type.String(), Type.Null()])), capacity: Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), Type.Null()])), status: Type.Optional(Type.String()) }, { additionalProperties: false })
    if ([...Value.Errors(s, request.body)].length > 0) { bad(reply, request); return }
    const b = request.body
    const { rows } = await app.db.query(
      `update buses set
        internal_number = coalesce($2, internal_number),
        plate_number = case when $3::boolean then $4 else plate_number end,
        make = case when $5::boolean then $6 else make end,
        model = case when $7::boolean then $8 else model end,
        capacity = case when $9::boolean then $10 else capacity end,
        status = coalesce($11, status),
        updated_at = now()
       where id = $1 returning *`,
      [request.params.id,
       b.internalNumber ?? null, b.plateNumber !== undefined, b.plateNumber ?? null,
       b.make !== undefined, b.make ?? null, b.model !== undefined, b.model ?? null,
       b.capacity !== undefined, b.capacity ?? null, b.status ?? null],
    )
    if (!rows[0]) { reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Not found', requestId: request.id } }); return }
    reply.send({ bus: rows[0] })
  }))

  app.post('/admin/buses/:id/archive', admin('fleet.manage', async (request, reply) => {
    if (!isUuid(request.params.id)) { bad(reply, request); return }
    const { rows } = await app.db.query('update buses set status = $2, archived_at = now(), updated_at = now() where id = $1 and archived_at is null returning *', [request.params.id, 'archived'])
    if (!rows[0]) { reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Not found', requestId: request.id } }); return }
    reply.send({ bus: rows[0] })
  }))

  // --- routes ---
  app.get('/admin/routes', admin('routes.manage', async (request, reply) => {
    const { rows } = await app.db.query('select * from routes order by created_at desc')
    reply.send({ routes: rows })
  }))

  app.post('/admin/routes', admin('routes.manage', async (request, reply) => {
    const s = Type.Object({ cityId: Type.String(), publicNumber: Type.String({ minLength: 1 }), nameRu: Type.String({ minLength: 1 }), nameKy: Type.String({ minLength: 1 }), color: Type.Optional(Type.String()) }, { additionalProperties: false })
    if ([...Value.Errors(s, request.body)].length > 0) { bad(reply, request); return }
    const b = request.body
    if (!isUuid(b.cityId)) { bad(reply, request); return }
    const { rows } = await app.db.query(
      `insert into routes (city_id, public_number, name_ru, name_ky, color) values ($1,$2,$3,$4,$5) returning *`,
      [b.cityId, b.publicNumber, b.nameRu, b.nameKy, b.color ?? null],
    )
    reply.code(201).send({ route: rows[0] })
  }))

  app.get('/admin/routes/:id', admin('routes.manage', async (request, reply) => {
    if (!isUuid(request.params.id)) { bad(reply, request); return }
    const { rows } = await app.db.query('select * from routes where id = $1', [request.params.id])
    if (!rows[0]) { reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Not found', requestId: request.id } }); return }
    reply.send({ route: rows[0] })
  }))

  app.patch('/admin/routes/:id', admin('routes.manage', async (request, reply) => {
    if (!isUuid(request.params.id)) { bad(reply, request); return }
    const s = Type.Object({ publicNumber: Type.Optional(Type.String({ minLength: 1 })), nameRu: Type.Optional(Type.String({ minLength: 1 })), nameKy: Type.Optional(Type.String({ minLength: 1 })), color: Type.Optional(Type.Union([Type.String(), Type.Null()])), status: Type.Optional(Type.String()) }, { additionalProperties: false })
    if ([...Value.Errors(s, request.body)].length > 0) { bad(reply, request); return }
    const b = request.body
    const { rows } = await app.db.query(
      `update routes set
        public_number = coalesce($2, public_number),
        name_ru = coalesce($3, name_ru),
        name_ky = coalesce($4, name_ky),
        color = case when $5::boolean then $6 else color end,
        status = coalesce($7, status),
        updated_at = now()
       where id = $1 returning *`,
      [request.params.id, b.publicNumber ?? null, b.nameRu ?? null, b.nameKy ?? null, b.color !== undefined, b.color ?? null, b.status ?? null],
    )
    if (!rows[0]) { reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Not found', requestId: request.id } }); return }
    reply.send({ route: rows[0] })
  }))

  app.post('/admin/routes/:id/archive', admin('routes.manage', async (request, reply) => {
    if (!isUuid(request.params.id)) { bad(reply, request); return }
    const { rows } = await app.db.query('update routes set status = $2, archived_at = now(), updated_at = now() where id = $1 and archived_at is null returning *', [request.params.id, 'archived'])
    if (!rows[0]) { reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Not found', requestId: request.id } }); return }
    reply.send({ route: rows[0] })
  }))

  // --- route directions ---
  app.get('/admin/route-directions', admin('routes.manage', async (request, reply) => {
    const routeId = request.query?.routeId
    const params = []
    let sql = 'select * from route_directions'
    if (routeId) { if (!isUuid(routeId)) { bad(reply, request); return }; sql += ' where route_id = $1'; params.push(routeId) }
    sql += ' order by created_at desc'
    const { rows } = await app.db.query(sql, params)
    reply.send({ routeDirections: rows })
  }))

  app.post('/admin/route-directions', admin('routes.manage', async (request, reply) => {
    const s = Type.Object({ routeId: Type.String(), nameRu: Type.String({ minLength: 1 }), nameKy: Type.String({ minLength: 1 }), headsignRu: Type.Optional(Type.String()), headsignKy: Type.Optional(Type.String()), geometryStatus: Type.Optional(Type.String()) }, { additionalProperties: false })
    if ([...Value.Errors(s, request.body)].length > 0) { bad(reply, request); return }
    const b = request.body
    if (!isUuid(b.routeId)) { bad(reply, request); return }
    const { rows } = await app.db.query(
      `insert into route_directions (route_id, name_ru, name_ky, headsign_ru, headsign_ky, geometry_status) values ($1,$2,$3,$4,$5,$6) returning *`,
      [b.routeId, b.nameRu, b.nameKy, b.headsignRu ?? null, b.headsignKy ?? null, b.geometryStatus ?? 'pending'],
    )
    reply.code(201).send({ routeDirection: rows[0] })
  }))

  app.patch('/admin/route-directions/:id', admin('routes.manage', async (request, reply) => {
    if (!isUuid(request.params.id)) { bad(reply, request); return }
    const s = Type.Object({ nameRu: Type.Optional(Type.String({ minLength: 1 })), nameKy: Type.Optional(Type.String({ minLength: 1 })), headsignRu: Type.Optional(Type.Union([Type.String(), Type.Null()])), headsignKy: Type.Optional(Type.Union([Type.String(), Type.Null()])), geometryStatus: Type.Optional(Type.String()), status: Type.Optional(Type.String()) }, { additionalProperties: false })
    if ([...Value.Errors(s, request.body)].length > 0) { bad(reply, request); return }
    const b = request.body
    const { rows } = await app.db.query(
      `update route_directions set
        name_ru = coalesce($2, name_ru),
        name_ky = coalesce($3, name_ky),
        headsign_ru = case when $4::boolean then $5 else headsign_ru end,
        headsign_ky = case when $6::boolean then $7 else headsign_ky end,
        geometry_status = coalesce($8, geometry_status),
        status = coalesce($9, status),
        updated_at = now()
       where id = $1 returning *`,
      [request.params.id, b.nameRu ?? null, b.nameKy ?? null, b.headsignRu !== undefined, b.headsignRu ?? null, b.headsignKy !== undefined, b.headsignKy ?? null, b.geometryStatus ?? null, b.status ?? null],
    )
    if (!rows[0]) { reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Not found', requestId: request.id } }); return }
    reply.send({ routeDirection: rows[0] })
  }))

  app.post('/admin/route-directions/:id/archive', admin('routes.manage', async (request, reply) => {
    if (!isUuid(request.params.id)) { bad(reply, request); return }
    const { rows } = await app.db.query('update route_directions set status = $2, archived_at = now(), updated_at = now() where id = $1 and archived_at is null returning *', [request.params.id, 'archived'])
    if (!rows[0]) { reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Not found', requestId: request.id } }); return }
    reply.send({ routeDirection: rows[0] })
  }))

  // --- stops ---
  app.get('/admin/stops', admin('fleet.manage', async (request, reply) => {
    const { rows } = await app.db.query('select * from stops order by created_at desc')
    reply.send({ stops: rows })
  }))

  app.post('/admin/stops', admin('fleet.manage', async (request, reply) => {
    const s = Type.Object({ cityId: Type.String(), nameRu: Type.String({ minLength: 1 }), nameKy: Type.String({ minLength: 1 }), code: Type.Optional(Type.String()), latitude: Type.Number(), longitude: Type.Number() }, { additionalProperties: false })
    if ([...Value.Errors(s, request.body)].length > 0) { bad(reply, request); return }
    const b = request.body
    if (!isUuid(b.cityId)) { bad(reply, request); return }
    const { rows } = await app.db.query(
      `insert into stops (city_id, name_ru, name_ky, code, location) values ($1,$2,$3,$4, ST_SetSRID(ST_MakePoint($6,$5),4326)::geography) returning *`,
      [b.cityId, b.nameRu, b.nameKy, b.code ?? null, b.latitude, b.longitude],
    )
    reply.code(201).send({ stop: rows[0] })
  }))

  app.patch('/admin/stops/:id', admin('fleet.manage', async (request, reply) => {
    if (!isUuid(request.params.id)) { bad(reply, request); return }
    const s = Type.Object({ nameRu: Type.Optional(Type.String({ minLength: 1 })), nameKy: Type.Optional(Type.String({ minLength: 1 })), code: Type.Optional(Type.Union([Type.String(), Type.Null()])), latitude: Type.Optional(Type.Number()), longitude: Type.Optional(Type.Number()) }, { additionalProperties: false })
    if ([...Value.Errors(s, request.body)].length > 0) { bad(reply, request); return }
    const b = request.body
    const { rows } = await app.db.query(
      `update stops set
        name_ru = coalesce($2, name_ru),
        name_ky = coalesce($3, name_ky),
        code = case when $4::boolean then $5 else code end,
        location = case when $6::boolean and $7::boolean then ST_SetSRID(ST_MakePoint($9,$8),4326)::geography else location end,
        updated_at = now()
       where id = $1 returning *`,
      [request.params.id, b.nameRu ?? null, b.nameKy ?? null, b.code !== undefined, b.code ?? null, b.latitude !== undefined, b.longitude !== undefined, b.latitude ?? null, b.longitude ?? null],
    )
    if (!rows[0]) { reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Not found', requestId: request.id } }); return }
    reply.send({ stop: rows[0] })
  }))

  app.post('/admin/stops/:id/archive', admin('fleet.manage', async (request, reply) => {
    if (!isUuid(request.params.id)) { bad(reply, request); return }
    const { rows } = await app.db.query('update stops set archived_at = now(), updated_at = now() where id = $1 and archived_at is null returning *', [request.params.id])
    if (!rows[0]) { reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Not found', requestId: request.id } }); return }
    reply.send({ stop: rows[0] })
  }))

  // --- route stops ---
  app.get('/admin/route-stops', admin('routes.manage', async (request, reply) => {
    const directionId = request.query?.directionId
    if (!directionId || !isUuid(directionId)) { bad(reply, request); return }
    const { rows } = await app.db.query('select * from route_stops where direction_id = $1 and archived_at is null order by sequence', [directionId])
    reply.send({ routeStops: rows })
  }))

  app.post('/admin/route-stops', admin('routes.manage', async (request, reply) => {
    const s = Type.Object({ directionId: Type.String(), stopId: Type.String(), sequence: Type.Integer({ minimum: 1 }) }, { additionalProperties: false })
    if ([...Value.Errors(s, request.body)].length > 0) { bad(reply, request); return }
    const b = request.body
    if (!isUuid(b.directionId) || !isUuid(b.stopId)) { bad(reply, request); return }
    const { rows } = await app.db.query(
      `insert into route_stops (direction_id, stop_id, sequence) values ($1,$2,$3) returning *`,
      [b.directionId, b.stopId, b.sequence],
    )
    reply.code(201).send({ routeStop: rows[0] })
  }))

  app.patch('/admin/route-stops/:id', admin('routes.manage', async (request, reply) => {
    if (!isUuid(request.params.id)) { bad(reply, request); return }
    const s = Type.Object({ sequence: Type.Integer({ minimum: 1 }) }, { additionalProperties: false })
    if ([...Value.Errors(s, request.body)].length > 0) { bad(reply, request); return }
    const { rows } = await app.db.query('update route_stops set sequence = $2 where id = $1 and archived_at is null returning *', [request.params.id, request.body.sequence])
    if (!rows[0]) { reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Not found', requestId: request.id } }); return }
    reply.send({ routeStop: rows[0] })
  }))

  app.post('/admin/route-stops/:id/archive', admin('routes.manage', async (request, reply) => {
    if (!isUuid(request.params.id)) { bad(reply, request); return }
    const { rows } = await app.db.query('update route_stops set archived_at = now() where id = $1 and archived_at is null returning *', [request.params.id])
    if (!rows[0]) { reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Not found', requestId: request.id } }); return }
    reply.send({ routeStop: rows[0] })
  }))

  // --- drivers (users with driver role) ---
  app.get('/admin/drivers', admin('trips.view', async (request, reply) => {
    const { rows } = await app.db.query(
      `select u.id, u.email, u.status, u.display_name, dp.id as profile_id, dp.city_id, dp.full_name, dp.status as profile_status, dp.is_active
         from users u left join driver_profiles dp on dp.user_id = u.id
        where exists (select 1 from user_roles r where r.user_id = u.id and r.role = 'driver')
        order by u.created_at desc`,
    )
    reply.send({ drivers: rows })
  }))
}
