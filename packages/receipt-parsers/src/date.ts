// Date and timezone conversion helpers. Output is always UTC in YYYY-MM-DDTHH:MM:SS+00:00 format.

const LOCAL_ISO_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/
const UTC_ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

const brusselsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Brussels',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** Format a UTC Date into YYYY-MM-DDTHH:MM:SS+00:00. */
export function formatUtcTimestamp(date: Date): string {
  return (
    `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}` +
    `T${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}+00:00`
  )
}

/** Compute Europe/Brussels offset in milliseconds (Brussels wall time - UTC) at a given UTC epoch ms. */
function brusselsOffsetMs(utcMs: number): number {
  const parts = brusselsFormatter.formatToParts(new Date(utcMs))
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const val = parts.find((p) => p.type === type)?.value
    return Number(val)
  }
  const wallAsUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  )
  return wallAsUtc - utcMs
}

/** Convert a timezone-naive Europe/Brussels local timestamp (e.g. "2026-03-07T14:05:12") to UTC. */
export function brusselsLocalToUtc(text: unknown): string | null {
  if (typeof text !== 'string') return null
  const match = LOCAL_ISO_RE.exec(text)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])

  const guessUtc = Date.UTC(year, month - 1, day, hour, minute, second)
  const check = new Date(guessUtc)
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    check.getUTCHours() !== hour ||
    check.getUTCMinutes() !== minute ||
    check.getUTCSeconds() !== second
  ) {
    return null
  }

  // Two-pass offset lookup handles DST transition boundaries accurately.
  const firstOffset = brusselsOffsetMs(guessUtc)
  const firstCandidate = guessUtc - firstOffset
  const secondOffset = brusselsOffsetMs(firstCandidate)
  const finalUtc = guessUtc - secondOffset

  return formatUtcTimestamp(new Date(finalUtc))
}

/** Parse a UTC/offset ISO 8601 timestamp and normalize to YYYY-MM-DDTHH:MM:SS+00:00. */
export function normalizeUtcTimestamp(text: unknown): string | null {
  if (typeof text !== 'string' || !UTC_ISO_RE.test(text)) return null
  const ms = Date.parse(text)
  if (!Number.isFinite(ms)) return null
  return formatUtcTimestamp(new Date(ms))
}
