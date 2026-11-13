export const GPS_STATUS = Object.freeze({
  LIVE: 'live',
  DELAYED: 'delayed',
  STALE: 'stale',
  OFFLINE: 'offline',
})

export function getGpsStatus(ageSeconds) {
  const age = Number(ageSeconds)
  if (!Number.isFinite(age) || age < 0) return GPS_STATUS.OFFLINE
  if (age <= 6) return GPS_STATUS.LIVE
  if (age <= 20) return GPS_STATUS.DELAYED
  if (age <= 60) return GPS_STATUS.STALE
  return GPS_STATUS.OFFLINE
}

export function isPubliclyCurrent(status) {
  return status === GPS_STATUS.LIVE || status === GPS_STATUS.DELAYED
}

export function formatAge(ageSeconds, locale = 'ru') {
  const age = Math.max(0, Math.round(Number(ageSeconds) || 0))
  if (locale === 'ky') {
    if (age < 60) return `${age} сек. мурун`
    return `${Math.floor(age / 60)} мүн. мурун`
  }
  if (age < 60) return `${age} сек. назад`
  return `${Math.floor(age / 60)} мин. назад`
}
