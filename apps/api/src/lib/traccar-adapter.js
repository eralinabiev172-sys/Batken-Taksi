// Adapter from Traccar's JSON forward payload to the BusWay internal ingest contract.
// Traccar deviceId is only a lookup key: the server maps it to a registered device
// (gps_devices.traccar_device_id). It is never used as an identity or as external_id.

const KNOTS_TO_MPS = 0.5144444444444444

export function traccarPositionToBusway(pos) {
  if (!pos || typeof pos !== 'object') return null
  const traccarDeviceId = pos.deviceId != null ? String(pos.deviceId) : null
  if (!traccarDeviceId || !/^[1-9]\d{0,17}$/.test(traccarDeviceId)) return null
  const measuredAt = pos.fixTime || pos.deviceTime || pos.serverTime
  if (!measuredAt) return null
  const measuredMs = Date.parse(measuredAt)
  if (!Number.isFinite(measuredMs)) return null
  // Traccar 6.6 forwards positions BEFORE they are stored, so position.id is always 0 and
  // cannot be used for dedupe. A deterministic key from device + fix time makes a retried
  // delivery of the same fix idempotent, while distinct fixes stay distinct.
  const gatewayPositionId = `tc${traccarDeviceId}-${measuredMs}`
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
    position: { latitude: lat, longitude: lon },
  }
  if (pos.serverTime) converted.receivedAt = pos.serverTime
  if (Number.isFinite(speedMps)) converted.speedMps = speedMps
  if (Number.isFinite(heading)) converted.headingDeg = heading
  if (Number.isFinite(accuracy)) converted.accuracyM = accuracy
  return converted
}

/** Traccar 6.6 forwards { position, device }; a bare position object is also accepted. */
export function unwrapTraccarItem(item) {
  return item && typeof item === 'object' && item.position && typeof item.position === 'object' ? item.position : item
}

export function traccarPayloadToBusway(payload) {
  const items = Array.isArray(payload) ? payload : [payload]
  const out = []
  for (const item of items) {
    const converted = traccarPositionToBusway(unwrapTraccarItem(item))
    if (converted) out.push(converted)
  }
  return out
}
