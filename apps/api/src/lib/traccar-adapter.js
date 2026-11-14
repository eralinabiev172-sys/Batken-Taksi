// Adapter from Traccar's JSON forward payload to the BusWay internal ingest contract.
// Traccar deviceId is only a lookup key: the server maps it to a registered device
// (gps_devices.traccar_device_id). It is never used as an identity or as external_id.

const KNOTS_TO_MPS = 0.5144444444444444

export function traccarPositionToBusway(pos) {
  if (!pos || typeof pos !== 'object') return null
  const gatewayPositionId = pos.id != null ? String(pos.id) : (pos.positionId != null ? String(pos.positionId) : null)
  if (!gatewayPositionId) return null
  const traccarDeviceId = pos.deviceId != null ? String(pos.deviceId) : null
  if (!traccarDeviceId || !/^[1-9]\d{0,17}$/.test(traccarDeviceId)) return null
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
  const converted = {
    gatewayPositionId,
    traccarDeviceId,
    measuredAt,
    sequence: pos.protocol != null ? `${pos.protocol}:${pos.id}` : String(pos.id),
    position: { latitude: lat, longitude: lon },
  }
  if (pos.serverTime) converted.receivedAt = pos.serverTime
  if (Number.isFinite(speedMps)) converted.speedMps = speedMps
  if (Number.isFinite(heading)) converted.headingDeg = heading
  if (Number.isFinite(accuracy)) converted.accuracyM = accuracy
  return converted
}

export function traccarPayloadToBusway(payload) {
  const items = Array.isArray(payload) ? payload : [payload]
  const out = []
  for (const item of items) {
    const converted = traccarPositionToBusway(item)
    if (converted) out.push(converted)
  }
  return out
}
