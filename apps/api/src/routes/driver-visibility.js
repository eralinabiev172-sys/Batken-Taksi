import { Value } from 'typebox/value'
import Type from 'typebox'

function bad(reply, request) { reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', requestId: request.id } }) }
function parseCookies(h) { const o = {}; if (typeof h !== 'string') return o; for (const p of h.split(';')) { const i = p.indexOf('='); if (i < 0) continue; const k = p.slice(0, i).trim(); const v = p.slice(i + 1).trim(); if (k) try { o[k] = decodeURIComponent(v) } catch { o[k] = v } } return o }

export default async function driverVisibilityRoutes(app) {
  app.get('/driver/public-visibility', async (request, reply) => {
    const session = await app.resolveSession(parseCookies(request.headers?.cookie)[app.SESSION_COOKIE || 'session'])
    if (!session) { reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required', requestId: request.id } }); return }
    if (!session.roles.includes('driver')) { reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden', requestId: request.id } }); return }
    const { rows } = await app.db.query(
      `select * from public_visibility_grants where driver_user_id = $1 and disabled_at is null order by enabled_at desc limit 1`,
      [session.userId],
    )
    const grant = rows[0]
    const now = Date.now()
    let enabled = false
    let remaining = 0
    if (grant && new Date(grant.expires_at).getTime() > now) {
      enabled = true
      remaining = Math.floor((new Date(grant.expires_at).getTime() - now) / 1000)
    }
    reply.send({ enabled, enabledAt: grant?.enabled_at ?? null, expiresAt: grant?.expires_at ?? null, remainingSeconds: remaining })
  })

  app.post('/driver/public-visibility', async (request, reply) => {
    const session = await app.resolveSession(parseCookies(request.headers?.cookie)[app.SESSION_COOKIE || 'session'])
    if (!session) { reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required', requestId: request.id } }); return }
    if (!session.roles.includes('driver')) { reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden', requestId: request.id } }); return }
    const s = Type.Object({ expiresAt: Type.String({ minLength: 1 }) }, { additionalProperties: false })
    if ([...Value.Errors(s, request.body)].length > 0) { bad(reply, request); return }
    const expiresAt = new Date(request.body.expiresAt)
    if (Number.isNaN(expiresAt.getTime())) { bad(reply, request); return }
    const now = new Date()
    if (expiresAt.getTime() <= now.getTime()) {
      reply.code(400).send({ error: { code: 'CUTOFF_MUST_BE_FUTURE', message: 'Cutoff must be future', requestId: request.id } }); return
    }
    // same day in Asia/Bishkek (UTC+6, no DST)
    const bishkekOffset = 6 * 60 * 60 * 1000
    const nowBishkek = new Date(now.getTime() + bishkekOffset)
    const expBishkek = new Date(expiresAt.getTime() + bishkekOffset)
    if (nowBishkek.toISOString().slice(0, 10) !== expBishkek.toISOString().slice(0, 10)) {
      reply.code(400).send({ error: { code: 'INVALID_CUTOFF_TIME', message: 'Cutoff must be today', requestId: request.id } }); return
    }
    // find active assignment
    const { rows: asn } = await app.db.query(
      `select id, bus_id from driver_bus_assignments where driver_user_id = $1 and revoked_at is null and (valid_to is null or valid_to > now()) order by valid_from desc limit 1`,
      [session.userId],
    )
    if (!asn[0]) { reply.code(409).send({ error: { code: 'NO_ACTIVE_ASSIGNMENT', message: 'No active assignment', requestId: request.id } }); return }
    const assignment = asn[0]
    // disable any existing active grant for this bus/assignment
    await app.db.query(
      `update public_visibility_grants set disabled_at = now(), disabled_reason = 'manual' where bus_id = $1 and disabled_at is null`,
      [assignment.bus_id],
    )
    const { rows } = await app.db.query(
      `insert into public_visibility_grants (driver_assignment_id, driver_user_id, bus_id, expires_at) values ($1,$2,$3,$4) returning *`,
      [assignment.id, session.userId, assignment.bus_id, expiresAt],
    )
    reply.code(201).send({ grant: rows[0], enabled: true, expiresAt: rows[0].expires_at })
  })

  app.delete('/driver/public-visibility', async (request, reply) => {
    const session = await app.resolveSession(parseCookies(request.headers?.cookie)[app.SESSION_COOKIE || 'session'])
    if (!session) { reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required', requestId: request.id } }); return }
    if (!session.roles.includes('driver')) { reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden', requestId: request.id } }); return }
    const { rows } = await app.db.query(
      `update public_visibility_grants set disabled_at = now(), disabled_reason = 'manual' where driver_user_id = $1 and disabled_at is null returning *`,
      [session.userId],
    )
    reply.send({ disabled: rows.length > 0 })
  })
}

// admin view
export async function adminVisibilityRoutes(app) {
  app.get('/admin/public-visibility-grants', async (request, reply) => {
    const session = await app.resolveSession(parseCookies(request.headers?.cookie)[app.SESSION_COOKIE || 'session'])
    if (!session) { reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required', requestId: request.id } }); return }
    if (!session.roles.includes('admin')) { reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden', requestId: request.id } }); return }
    const { rows } = await app.db.query('select * from public_visibility_grants order by enabled_at desc')
    reply.send({ grants: rows })
  })
}