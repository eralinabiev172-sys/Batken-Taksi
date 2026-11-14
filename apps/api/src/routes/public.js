import { VISIBLE_SQL, toPublicVehicle } from '../lib/public-vehicles.js'

// Public, read-only API for the passenger map (no registration). GET only: the CSRF hook does not
// apply, and nothing here changes state. Internal ids are never returned; only public ids.
const DEFAULT_COLOR = '#176b4b'

function approvedPath(geojson) {
  if (!geojson || geojson.type !== 'LineString' || !Array.isArray(geojson.coordinates)) return null
  return geojson.coordinates.map(([lon, lat]) => [lat, lon])
}

export default async function publicRoutes(app) {
  app.get('/routes', async (_request, reply) => {
    const { rows: routes } = await app.db.query(
      `select id, public_id, public_number, color, name_ru, name_ky
         from routes where status = 'active' and archived_at is null order by public_number`,
    )
    const { rows: directions } = await app.db.query(
      `select rd.id, rd.public_id, rd.route_id, rd.name_ru, rd.name_ky, rd.geometry_status,
              case when rd.geometry_status = 'approved' and rd.geometry is not null
                   then ST_AsGeoJSON(rd.geometry)::json end as path
         from route_directions rd
        where rd.status = 'active' and rd.archived_at is null
        order by rd.created_at`,
    )
    const { rows: stops } = await app.db.query(
      `select rs.direction_id, rs.sequence, s.public_id, s.name_ru, s.name_ky,
              ST_Y(s.location::geometry) as latitude, ST_X(s.location::geometry) as longitude
         from route_stops rs
         join stops s on s.id = rs.stop_id
        where rs.archived_at is null and s.archived_at is null
        order by rs.direction_id, rs.sequence`,
    )

    const stopsByDirection = new Map()
    for (const row of stops) {
      if (!stopsByDirection.has(row.direction_id)) stopsByDirection.set(row.direction_id, [])
      stopsByDirection.get(row.direction_id).push(row)
    }
    const stopDto = (row, kind) => ({
      id: row.public_id,
      kind,
      name: { ru: row.name_ru, ky: row.name_ky },
      position: [row.latitude, row.longitude],
    })

    const result = routes.map((route) => {
      const own = directions.filter((d) => d.route_id === route.id)
      const seen = new Map()
      const directionDtos = own.map((d) => {
        const list = stopsByDirection.get(d.id) ?? []
        list.forEach((row, index) => {
          const kind = index === 0 || index === list.length - 1 ? 'terminal' : 'stop'
          if (!seen.has(row.public_id) || kind === 'terminal') seen.set(row.public_id, stopDto(row, kind))
        })
        return {
          id: d.public_id,
          name: { ru: d.name_ru, ky: d.name_ky },
          originStopId: list[0]?.public_id ?? null,
          destinationStopId: list.at(-1)?.public_id ?? null,
          path: approvedPath(d.path),
          geometryStatus: d.geometry_status === 'approved' && d.path ? 'approved' : 'pendingConfirmation',
        }
      })
      return {
        id: route.public_id,
        number: route.public_number,
        color: route.color ?? DEFAULT_COLOR,
        name: { ru: route.name_ru, ky: route.name_ky },
        geometryStatus: directionDtos.length > 0 && directionDtos.every((d) => d.geometryStatus === 'approved') ? 'approved' : 'pendingConfirmation',
        stops: [...seen.values()],
        directions: directionDtos,
      }
    })
    reply.send({ routes: result })
  })

  // Grant is checked inside the query on every request (never cached).
  app.get('/vehicles/live', async (_request, reply) => {
    const { rows } = await app.db.query(VISIBLE_SQL)
    reply.send({ vehicles: rows.map(toPublicVehicle) })
  })
}
