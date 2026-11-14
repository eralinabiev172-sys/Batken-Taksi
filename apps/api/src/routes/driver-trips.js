import { Value } from 'typebox/value'
import Type from 'typebox'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function isUuid(v) { return typeof v === 'string' && UUID_RE.test(v) }
function bad(reply, request) { reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', requestId: request.id } }) }


export default async function driverTripsRoutes(app) {
  app.get('/driver/trips/active', async (request, reply) => {
    const session = await app.resolveSession(parseCookie(request.headers?.cookie))
    if (!session) { reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required', requestId: request.id } }); return }
    const { rows } = await app.db.query('select * from trips where driver_user_id = $1 and status = $2', [session.userId, 'active'])
    reply.send({ trip: rows[0] ?? null })
  })

  app.post('/driver/trips', async (request, reply) => {
    const session = await app.resolveSession(parseCookie(request.headers?.cookie))
    if (!session) { reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required', requestId: request.id } }); return }
    if (!session.roles.includes('driver')) { reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden', requestId: request.id } }); return }
    const s = Type.Object({ routeDirectionId: Type.Optional(Type.String()), driverAssignmentId: Type.Optional(Type.String()) }, { additionalProperties: false })
    if ([...Value.Errors(s, request.body || {})].length > 0) { bad(reply, request); return }
    const b = request.body || {}
    // find active assignment for this driver
    const { rows: asn } = await app.db.query(
      `select id, bus_id from driver_bus_assignments where driver_user_id = $1 and revoked_at is null and (valid_to is null or valid_to > now()) order by valid_from desc limit 1`,
      [session.userId],
    )
    if (!asn[0]) { reply.code(409).send({ error: { code: 'NO_ACTIVE_ASSIGNMENT', message: 'No active assignment', requestId: request.id } }); return }
    const assignment = asn[0]
    if (b.driverAssignmentId && b.driverAssignmentId !== assignment.id) {
      reply.code(409).send({ error: { code: 'NO_ACTIVE_ASSIGNMENT', message: 'No active assignment', requestId: request.id } }); return
    }
    if (b.routeDirectionId && !isUuid(b.routeDirectionId)) { bad(reply, request); return }
    try {
      const { rows } = await app.db.query(
        `insert into trips (driver_assignment_id, driver_user_id, bus_id, route_direction_id, status) values ($1,$2,$3,$4,'active') returning *`,
        [assignment.id, session.userId, assignment.bus_id, b.routeDirectionId ?? null],
      )
      reply.code(201).send({ trip: rows[0] })
    } catch (err) {
      if (err?.code === '23505') {
        reply.code(409).send({ error: { code: 'ACTIVE_TRIP_EXISTS', message: 'Active trip exists', requestId: request.id } }); return
      }
      throw err
    }
  })

  app.post('/driver/trips/:id/complete', async (request, reply) => {
    const session = await app.resolveSession(parseCookie(request.headers?.cookie))
    if (!session) { reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required', requestId: request.id } }); return }
    if (!session.roles.includes('driver')) { reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden', requestId: request.id } }); return }
    if (!isUuid(request.params.id)) { bad(reply, request); return }
    const { rows } = await app.db.query(
      `update trips set status = 'completed', ended_at = now(), updated_at = now() where id = $1 and driver_user_id = $2 and status = 'active' returning *`,
      [request.params.id, session.userId],
    )
    if (!rows[0]) { reply.code(409).send({ error: { code: 'TRIP_NOT_ACTIVE', message: 'Trip not active', requestId: request.id } }); return }
    reply.send({ trip: rows[0] })
  })
}

function parseCookie(header) {
  const out = {}
  if (typeof header !== 'string') return out
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx < 0) continue
    const k = part.slice(0, idx).trim()
    const v = part.slice(idx + 1).trim()
    if (k) try { out[k] = decodeURIComponent(v) } catch { out[k] = v }
  }
  return out
}