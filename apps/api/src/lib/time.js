/**
 * Calendar-day helpers based on the IANA time zone database (D-128).
 * A fixed "UTC+6" offset is deliberately not used.
 */
export const BISHKEK_TZ = 'Asia/Bishkek'

const formatters = new Map()

function formatterFor(timeZone) {
  let formatter = formatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    formatters.set(timeZone, formatter)
  }
  return formatter
}

function localParts(date, timeZone) {
  const parts = {}
  for (const { type, value } of formatterFor(timeZone).formatToParts(date)) {
    if (type !== 'literal') parts[type] = Number(value)
  }
  return parts
}

/** Offset of `timeZone` from UTC at the given instant, in milliseconds. */
export function getOffsetMs(date, timeZone = BISHKEK_TZ) {
  const p = localParts(date, timeZone)
  const localAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return localAsUtc - Math.floor(date.getTime() / 1000) * 1000
}

/** Local calendar date "YYYY-MM-DD" of an instant. */
export function localDateString(date, timeZone = BISHKEK_TZ) {
  const p = localParts(date, timeZone)
  const pad = (n, width = 2) => String(n).padStart(width, '0')
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`
}

function startOfCivilDay(year, month, day, timeZone) {
  const guess = Date.UTC(year, month - 1, day)
  const firstOffset = getOffsetMs(new Date(guess), timeZone)
  let instant = guess - firstOffset
  const secondOffset = getOffsetMs(new Date(instant), timeZone)
  if (secondOffset !== firstOffset) instant = guess - secondOffset
  return new Date(instant)
}

/**
 * Bounds of the local calendar day containing `date`.
 * `end` is exclusive: the first instant of the next local day.
 */
export function localDayBounds(date, timeZone = BISHKEK_TZ) {
  const p = localParts(date, timeZone)
  const start = startOfCivilDay(p.year, p.month, p.day, timeZone)
  const next = new Date(Date.UTC(p.year, p.month - 1, p.day + 1))
  const end = startOfCivilDay(
    next.getUTCFullYear(),
    next.getUTCMonth() + 1,
    next.getUTCDate(),
    timeZone,
  )
  return { start, end }
}

export function isSameLocalDay(a, b, timeZone = BISHKEK_TZ) {
  return localDateString(a, timeZone) === localDateString(b, timeZone)
}
