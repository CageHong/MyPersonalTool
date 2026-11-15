import { isAhReceiptData, parseAhReceipts } from './ah'
import { isLidlReceiptData, parseLidlReceipts } from './lidl'
import { ReceiptFormatError, type ReceiptParseResult, type ReceiptSource } from './types'

interface ReceiptParserEntry {
  source: ReceiptSource
  matches: (json: unknown) => boolean
  parse: (json: unknown) => ReceiptParseResult
}

const PARSERS: readonly ReceiptParserEntry[] = [
  { source: 'lidl_be', matches: isLidlReceiptData, parse: parseLidlReceipts },
  { source: 'ah_be', matches: isAhReceiptData, parse: parseAhReceipts },
]

/** Detect which receipt export format the parsed JSON belongs to, or null if unrecognized. */
export function detectReceiptSource(json: unknown): ReceiptSource | null {
  return PARSERS.find((entry) => entry.matches(json))?.source ?? null
}

/** Detect the receipt source and parse it; throws ReceiptFormatError if unrecognized. */
export function parseReceipts(json: unknown): ReceiptParseResult {
  const parser = PARSERS.find((entry) => entry.matches(json))
  if (!parser) {
    throw new ReceiptFormatError('Unrecognized receipt export format')
  }
  return parser.parse(json)
}
