export default async function adminGpsRoutes(app) {
  const admin = (permission, handler) => app.requirePermission(permission, async (request, reply) => {
    if (!request.session?.roles?.includes('admin')) {
      reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden', requestId: request.id } }); return
    }
    return handler(request, reply)
  })

  app.get('/admin/live-vehicles', admin('grants.view', async (request, reply) => {
    const { rows } = await app.db.query(
      `select v.bus_id, v.trip_id, v.position, v.measured_at, v.received_at, v.freshness, v.speed_mps, v.heading_deg, v.updated_at,
              g.id as grant_id, g.expires_at as grant_expires_at, g.disabled_at as grant_disabled_at
         from vehicle_live_states v
         left join public_visibility_grants g on g.bus_id = v.bus_id and g.disabled_at is null
        order by v.updated_at desc`,
    )
    reply.send({ liveVehicles: rows })
  }))

  app.get('/admin/tracker-health', admin('devices.manage', async (request, reply) => {
    const { rows } = await app.db.query(
      `select id, external_id, status, last_seen_at, firmware, protocol, auth_mode, archived_at from gps_devices order by last_seen_at desc nulls last`,
    )
    reply.send({ trackers: rows })
  }))
}
