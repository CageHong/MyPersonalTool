// Wise 交易紀錄 CSV 的解析。一列一筆交易;換匯(NEUTRAL)一列有兩個幣別的變動。
//
// 金額欄是「扣掉手續費之後」的數字,手續費另外從來源帳戶扣,所以手續費放在 fee,不併進 movements。
// 入帳(IN)的手續費是匯款人在 Wise 之外付的,不影響 Wise 的餘額:fee 是 null,原始值留在 raw。

import { readCsvTable } from './csv'
import { isUnsignedDecimal, isZeroDecimal } from './decimal'
import { StatementFormatError } from './types'
import type {
  ParseResult,
  PendingFee,
  PendingTransaction,
  SkippedRow,
  SkipReason,
} from './types'

const COLUMNS = {
  id: 'ID',
  status: 'Status',
  direction: 'Direction',
  createdOn: 'Created on',
  sourceFeeAmount: 'Source fee amount',
  sourceFeeCurrency: 'Source fee currency',
  sourceName: 'Source name',
  sourceAmount: 'Source amount (after fees)',
  sourceCurrency: 'Source currency',
  targetName: 'Target name',
  targetAmount: 'Target amount (after fees)',
  targetCurrency: 'Target currency',
  exchangeRate: 'Exchange rate',
  reference: 'Reference',
  category: 'Category',
} as const

// 不是每一份匯出都有的欄位:有就讀,沒有不算缺欄位
const NOTE_COLUMN = 'Note'

export const WISE_CSV_COLUMNS: readonly string[] = Object.values(COLUMNS)

export function isWiseCsvHeader(header: readonly string[]): boolean {
  const present = new Set(header)
  return WISE_CSV_COLUMNS.every((name) => present.has(name))
}

export function wiseAccount(currency: string): string {
  return `wise:${currency}`
}

// 'YYYY-MM-DD HH:MM:SS'(UTC)→ 'YYYY-MM-DDTHH:MM:SS+00:00';不是合法的日期時間時回傳 null
function toUtcIso(raw: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(raw)
  if (!match) return null
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number)
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second))
  const roundTrips =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second
  return roundTrips ? `${raw.replace(' ', 'T')}+00:00` : null
}

function isPositiveDecimal(text: string): boolean {
  return isUnsignedDecimal(text) && !isZeroDecimal(text)
}

type RowOutcome = PendingTransaction | { reason: SkipReason; detail: string }

function parseRow(raw: Record<string, string>, line: number): RowOutcome {
  const value = (column: string) => raw[column].trim()
  const status = value(COLUMNS.status).toUpperCase()
  const direction = value(COLUMNS.direction).toUpperCase()

  // 只收已完成的;退款(REFUNDED)只收入帳那一方
  const accepted = status === 'COMPLETED' || (status === 'REFUNDED' && direction === 'IN')
  if (!accepted) return { reason: 'status', detail: `${status} ${direction}`.trim() }

  const externalId = value(COLUMNS.id)
  if (externalId === '') return { reason: 'missing_id', detail: '' }

  if (direction !== 'OUT' && direction !== 'IN' && direction !== 'NEUTRAL') {
    return { reason: 'unknown_direction', detail: direction }
  }

  const occurredAt = toUtcIso(value(COLUMNS.createdOn))
  if (occurredAt === null) return { reason: 'invalid_date', detail: value(COLUMNS.createdOn) }

  const sourceAmount = value(COLUMNS.sourceAmount)
  const sourceCurrency = value(COLUMNS.sourceCurrency).toUpperCase()
  const targetAmount = value(COLUMNS.targetAmount)
  const targetCurrency = value(COLUMNS.targetCurrency).toUpperCase()

  const needsSource = direction !== 'IN'
  const needsTarget = direction !== 'OUT'
  if (needsSource && (!isPositiveDecimal(sourceAmount) || sourceCurrency === '')) {
    return { reason: 'invalid_amount', detail: `${sourceAmount} ${sourceCurrency}`.trim() }
  }
  if (needsTarget && (!isPositiveDecimal(targetAmount) || targetCurrency === '')) {
    return { reason: 'invalid_amount', detail: `${targetAmount} ${targetCurrency}`.trim() }
  }

  let fee: PendingFee | null = null
  const feeAmount = value(COLUMNS.sourceFeeAmount)
  const feeCurrency = value(COLUMNS.sourceFeeCurrency).toUpperCase()
  if (direction !== 'IN' && feeAmount !== '' && !isZeroDecimal(feeAmount)) {
    if (!isUnsignedDecimal(feeAmount) || feeCurrency === '') {
      return { reason: 'invalid_amount', detail: `${feeAmount} ${feeCurrency}`.trim() }
    }
    fee = { account: wiseAccount(feeCurrency), currency: feeCurrency, amount: feeAmount }
  }

  const outflow = {
    account: wiseAccount(sourceCurrency),
    currency: sourceCurrency,
    amount: `-${sourceAmount}`,
  }
  const inflow = {
    account: wiseAccount(targetCurrency),
    currency: targetCurrency,
    amount: targetAmount,
  }
  const orNull = (text: string) => (text === '' ? null : text)
  const common = {
    source: 'wise_csv' as const,
    externalId,
    occurredAt,
    fee,
    reference: orNull(value(COLUMNS.reference)),
    note: orNull((raw[NOTE_COLUMN] ?? '').trim()),
    sourceCategory: orNull(value(COLUMNS.category)),
    line,
    raw,
  }

  if (direction === 'OUT') {
    return {
      ...common,
      kind: 'out',
      movements: [outflow],
      counterparty: orNull(value(COLUMNS.targetName)),
    }
  }
  if (direction === 'IN') {
    return {
      ...common,
      kind: 'in',
      movements: [inflow],
      counterparty: orNull(value(COLUMNS.sourceName)),
    }
  }
  return { ...common, kind: 'exchange', movements: [outflow, inflow], counterparty: null }
}

// 呼叫前先用 isWiseCsvHeader(或 detectSource)確認是 Wise 的檔案;欄位不齊時丟出錯誤
export function parseWiseCsv(text: string): ParseResult {
  const { header, records } = readCsvTable(text)
  if (!isWiseCsvHeader(header)) {
    const present = new Set(header)
    const missing = WISE_CSV_COLUMNS.filter((name) => !present.has(name))
    throw new StatementFormatError(`不是 Wise 的 CSV,缺少欄位:${missing.join('、')}`)
  }

  const transactions: PendingTransaction[] = []
  const skipped: SkippedRow[] = []
  for (const { line, record, fields } of records) {
    if (record === null) {
      const raw = Object.fromEntries(fields.map((field, index) => [String(index), field]))
      skipped.push({ line, reason: 'malformed_row', detail: `${fields.length} 欄`, raw })
      continue
    }
    const outcome = parseRow(record, line)
    if ('reason' in outcome) skipped.push({ line, ...outcome, raw: record })
    else transactions.push(outcome)
  }
  return { source: 'wise_csv', transactions, skipped }
}
