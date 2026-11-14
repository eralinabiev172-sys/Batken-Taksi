import { runReconciliation } from '../services/reconciliation.js'

export default async function adminReconciliationRoutes(app) {
  app.post('/admin/reconciliation/run', async (request, reply) => {
    const session = await app.resolveSession(parseCookie(request.headers?.cookie)[app.SESSION_COOKIE])
    if (!session) { reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required', requestId: request.id } }); return }
    if (!session.roles.includes('admin')) { reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden', requestId: request.id } }); return }
    const result = await runReconciliation(app.db)
    reply.send(result)
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