// Exact decimal arithmetic for two-decimal-place currency amounts using bigint cents.
// Floating-point numbers are never used for summation or comparison.

const MONEY_PATTERN = /^(-?)(\d+)(?:\.(\d{1,2}))?$/
const QUANTITY_PATTERN = /^\d+(?:\.\d+)?$/

const ZERO = BigInt(0)
const HUNDRED = BigInt(100)

/** Parse a dot-decimal money string (up to 2 decimal places) into integer cents. */
export function parseCents(text: string): bigint | null {
  const match = MONEY_PATTERN.exec(text)
  if (!match) return null

  const negative = match[1] === '-'
  const whole = BigInt(match[2])
  const fracRaw = match[3] ?? ''
  const frac = BigInt(fracRaw.padEnd(2, '0'))
  const magnitude = whole * HUNDRED + frac
  if (magnitude === ZERO) return ZERO
  return negative ? -magnitude : magnitude
}

/** Format integer cents into a two-decimal-place string (e.g. "1.40", "-0.50"). */
export function formatCents(cents: bigint): string {
  if (cents === ZERO) return '0.00'
  const negative = cents < ZERO
  const abs = negative ? -cents : cents
  const whole = abs / HUNDRED
  const frac = (abs % HUNDRED).toString().padStart(2, '0')
  return `${negative ? '-' : ''}${whole}.${frac}`
}

/** Normalize a dot-decimal money string to 2 decimal places, or return null if invalid. */
export function normalizeMoneyString(text: string): string | null {
  const cents = parseCents(text)
  return cents === null ? null : formatCents(cents)
}

/** Normalize a European comma-decimal money string (e.g. "1,40" or "-0,32") to "1.40". */
export function normalizeCommaMoney(text: string): string | null {
  if (!/^-?\d+(?:,\d{1,2})?$/.test(text)) return null
  return normalizeMoneyString(text.replace(',', '.'))
}

/** Convert a JSON number to a two-decimal-place string; return null if it has >2 decimals or is non-finite. */
export function numberToMoneyString(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const formatted = value.toFixed(2)
  if (Number(formatted) !== value) return null
  return formatted === '-0.00' ? '0.00' : formatted
}

/** Normalize a European comma-decimal quantity string (e.g. "1,082" -> "1.082", "2" -> "2"). */
export function normalizeQuantity(text: string): string | null {
  const dotted = text.replace(',', '.')
  return QUANTITY_PATTERN.test(dotted) ? dotted : null
}

/** Sum an array of two-decimal-place money strings exactly using bigint cents. */
export function sumAmounts(amounts: readonly string[]): string {
  let total = ZERO
  for (const amount of amounts) {
    const cents = parseCents(amount)
    if (cents === null) {
      throw new Error(`Invalid money amount in sumAmounts: ${amount}`)
    }
    total += cents
  }
  return formatCents(total)
}

/** Compare two money strings for exact numeric equality. */
export function amountsEqual(a: string, b: string): boolean {
  const ca = parseCents(a)
  const cb = parseCents(b)
  return ca !== null && cb !== null && ca === cb
}
