export const BISHKEK_TIME_ZONE = 'Asia/Bishkek'

function zonedParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BISHKEK_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date)
  return Object.fromEntries(parts.map(({ type, value }) => [type, value]))
}

export function bishkekCutoffToIso(cutoffTime, now = new Date()) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(cutoffTime)) throw new Error('INVALID_CUTOFF_TIME')
  const parts = zonedParts(now)
  const [hours, minutes] = cutoffTime.split(':').map(Number)
  const utcMs = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), hours - 6, minutes)
  if (utcMs <= now.getTime()) throw new Error('CUTOFF_MUST_BE_FUTURE')
  return new Date(utcMs).toISOString()
}

export function endOfCurrentBishkekDay(now = new Date()) {
  const parts = zonedParts(now)
  return new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), 17, 59, 59, 999)).toISOString()
}

export function isVisibilityActive(grant, now = new Date()) {
  return Boolean(grant?.enabled && grant.expiresAt && new Date(grant.expiresAt).getTime() > now.getTime())
}

export function remainingSeconds(grant, now = new Date()) {
  if (!isVisibilityActive(grant, now)) return 0
  return Math.max(0, Math.ceil((new Date(grant.expiresAt).getTime() - now.getTime()) / 1000))
}

export function formatRemaining(totalSeconds, locale = 'ru') {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (locale === 'ky') return `${hours} с ${minutes} мүн калды`
  return `Осталось ${hours} ч ${minutes} мин`
}
