// Adapter from Traccar's JSON forward payload to BusWay internal ingest contract.
// Traccar forward.type=json sends position objects; see https://www.traccar.org/forwarding/

const KNOTS_TO_MPS = 0.5144444444444444

export function traccarPositionToBusway(pos, deviceExternalId) {
  if (!pos || typeof pos !== 'object') return null
  const gatewayPositionId = pos.id != null ? String(pos.id) : (pos.positionId != null ? String(pos.positionId) : null)
  if (!gatewayPositionId) return null
  const externalId = deviceExternalId || (pos.deviceId != null ? String(pos.deviceId) : null)
  if (!externalId) return null
  const measuredAt = pos.fixTime || pos.deviceTime || pos.serverTime
  if (!measuredAt) return null
  const lat = Number(pos.latitude)
  const lon = Number(pos.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null
  const speed = pos.speed != null ? Number(pos.speed) : undefined
  const speedMps = Number.isFinite(speed) ? speed * KNOTS_TO_MPS : undefined
  const heading = pos.course != null ? Number(pos.course) : undefined
  const accuracy = pos.accuracy != null ? Number(pos.accuracy) : undefined
  return {
    gatewayPositionId,
    deviceExternalId: externalId,
    measuredAt,
    receivedAt: pos.serverTime || undefined,
    sequence: pos.protocol != null ? `${pos.protocol}:${pos.id}` : String(pos.id),
    position: { latitude: lat, longitude: lon },
    speedMps: Number.isFinite(speedMps) ? speedMps : undefined,
    headingDeg: Number.isFinite(heading) ? heading : undefined,
    accuracyM: Number.isFinite(accuracy) ? accuracy : undefined,
    attributes: pos.attributes && typeof pos.attributes === 'object' ? pos.attributes : {},
  }
}

export function traccarPayloadToBusway(payload, deviceMap = {}) {
  const items = Array.isArray(payload) ? payload : [payload]
  const out = []
  for (const item of items) {
    const externalId = deviceMap[item?.deviceId] || deviceMap[String(item?.deviceId)]
    const converted = traccarPositionToBusway(item, externalId)
    if (converted) out.push(converted)
  }
  return out
}