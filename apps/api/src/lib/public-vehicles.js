// Public vehicle view shared by REST (/vehicles/live) and WebSocket (/ws/v1/live).
// A bus is visible only with an enabled, unexpired grant (D-127); trips are never consulted for
// visibility. Route/direction are included only as optional context from the bus's active trip.
export const VISIBLE_SQL = `select v.bus_id, b.public_id as vehicle_public_id,
         ST_Y(v.position) as latitude, ST_X(v.position) as longitude,
         v.measured_at, v.freshness, v.speed_mps, v.heading_deg,
         greatest(0, extract(epoch from (now() - v.measured_at)))::float8 as age_seconds,
         tr.route_public_id, tr.direction_public_id
    from vehicle_live_states v
    join buses b on b.id = v.bus_id
    left join lateral (
      select r.public_id as route_public_id, rd.public_id as direction_public_id
        from trips t
        join route_directions rd on rd.id = t.route_direction_id
        join routes r on r.id = rd.route_id
       where t.bus_id = v.bus_id and t.status = 'active'
       limit 1
    ) tr on true
   where exists (select 1 from public_visibility_grants g
                  where g.bus_id = v.bus_id and g.disabled_at is null and g.expires_at > now())`

/** Public DTO: no internal ids, no driver, no device or SIM data. */
export function toPublicVehicle(row) {
  return {
    vehiclePublicId: row.vehicle_public_id,
    latitude: row.latitude,
    longitude: row.longitude,
    measuredAt: row.measured_at,
    ageSeconds: Math.round(row.age_seconds),
    freshness: row.freshness,
    speedMps: row.speed_mps,
    headingDeg: row.heading_deg,
    routeId: row.route_public_id ?? null,
    directionId: row.direction_public_id ?? null,
  }
}
