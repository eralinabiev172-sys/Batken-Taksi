export default async function adminAuditRoutes(app) {
  app.get('/admin/fault-reports', async (request, reply) => {
    const session = await app.resolveSession(parseCookie(request.headers?.cookie)[app.SESSION_COOKIE])
    if (!session) { reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required', requestId: request.id } }); return }
    if (!session.roles.includes('admin')) { reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden', requestId: request.id } }); return }
    const { rows } = await app.db.query('select * from fault_reports order by created_at desc')
    reply.send({ faultReports: rows })
  })

  app.post('/admin/fault-reports', async (request, reply) => {
    const session = await app.resolveSession(parseCookie(request.headers?.cookie)[app.SESSION_COOKIE])
    if (!session) { reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required', requestId: request.id } }); return }
    if (!session.roles.includes('admin') && !session.roles.includes('driver')) { reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden', requestId: request.id } }); return }
    const b = request.body || {}
    const { rows } = await app.db.query(
      `insert into fault_reports (trip_id, bus_id, driver_user_id, category, description) values ($1,$2,$3,$4,$5) returning *`,
      [b.tripId ?? null, b.busId ?? null, session.userId, b.category ?? 'unknown', b.description ?? ''],
    )
    reply.code(201).send({ faultReport: rows[0] })
  })

  app.get('/admin/audit-logs', async (request, reply) => {
    const session = await app.resolveSession(parseCookie(request.headers?.cookie)[app.SESSION_COOKIE])
    if (!session) { reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required', requestId: request.id } }); return }
    if (!session.roles.includes('admin')) { reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden', requestId: request.id } }); return }
    const { rows } = await app.db.query('select id, occurred_at, actor_user_id, action, entity_type, entity_id, request_id, result, correlation_id, created_at from audit_logs order by occurred_at desc limit 200')
    reply.send({ auditLogs: rows })
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