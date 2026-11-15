import { normalizeUtcTimestamp } from './date'
import { amountsEqual, numberToMoneyString, sumAmounts } from './decimal'
import {
  ReceiptFormatError,
  type ParsedReceipt,
  type ReceiptLine,
  type ReceiptParseResult,
  type SkippedReceipt,
} from './types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isAhReceiptData(json: unknown): boolean {
  if (!isRecord(json) || !Array.isArray(json.receipts)) return false
  return json.receipts.some((entry) => isRecord(entry) && Array.isArray(entry.products))
}

function readMoneyField(obj: unknown): string | null {
  if (!isRecord(obj)) return null
  return numberToMoneyString(obj.amount)
}

/** Parse a Belgian Albert Heijn receipt export JSON object. */
export function parseAhReceipts(json: unknown): ReceiptParseResult {
  if (!isRecord(json) || !Array.isArray(json.receipts) || !Array.isArray(json.summaries)) {
    throw new ReceiptFormatError('Expected AH receipt export with summaries and receipts arrays')
  }

  const receipts: ParsedReceipt[] = []
  const skipped: SkippedReceipt[] = []

  const summaryById = new Map<string, Record<string, unknown>>()
  for (const summary of json.summaries) {
    if (!isRecord(summary) || typeof summary.id !== 'string' || summary.id === '') {
      skipped.push({
        externalId: null,
        reason: 'malformed',
        detail: 'Summary entry is missing a valid string id',
      })
      continue
    }
    summaryById.set(summary.id, summary)
  }

  const seenSummaryIds = new Set<string>()

  for (const receipt of json.receipts) {
    if (!isRecord(receipt) || typeof receipt.id !== 'string' || receipt.id === '') {
      skipped.push({
        externalId: null,
        reason: 'malformed',
        detail: 'Receipt entry is missing a valid string id',
      })
      continue
    }

    const externalId = receipt.id
    const summary = summaryById.get(externalId)
    if (!summary) {
      skipped.push({
        externalId,
        reason: 'missing_detail',
        detail: 'Receipt has no matching summary entry',
      })
      continue
    }
    seenSummaryIds.add(externalId)

    const occurredAt = normalizeUtcTimestamp(summary.dateTime)
    if (occurredAt === null) {
      skipped.push({
        externalId,
        reason: 'invalid_date',
        detail: `Invalid summary dateTime: ${String(summary.dateTime)}`,
      })
      continue
    }

    const total = readMoneyField(summary.totalAmount)
    if (total === null) {
      skipped.push({
        externalId,
        reason: 'invalid_amount',
        detail: 'Invalid summary totalAmount',
      })
      continue
    }

    if (!Array.isArray(receipt.products)) {
      skipped.push({
        externalId,
        reason: 'malformed',
        detail: 'Receipt is missing products array',
      })
      continue
    }

    const lines: ReceiptLine[] = []
    let position = 0
    let lineError: { reason: 'invalid_amount' | 'malformed'; detail: string } | null = null

    for (const product of receipt.products) {
      if (!isRecord(product)) {
        lineError = { reason: 'malformed', detail: 'Product entry is not an object' }
        break
      }
      if (typeof product.name !== 'string') {
        lineError = { reason: 'malformed', detail: 'Product is missing string name' }
        break
      }
      if (typeof product.quantity !== 'number' || !Number.isFinite(product.quantity)) {
        lineError = { reason: 'malformed', detail: 'Product has invalid quantity' }
        break
      }

      const amount = readMoneyField(product.amount)
      if (amount === null) {
        lineError = { reason: 'invalid_amount', detail: `Invalid product amount for ${product.name}` }
        break
      }

      let unitPrice: string | null = null
      if (product.price !== null && product.price !== undefined) {
        unitPrice = readMoneyField(product.price)
        if (unitPrice === null) {
          lineError = { reason: 'invalid_amount', detail: `Invalid product price for ${product.name}` }
          break
        }
      }

      const articleId =
        product.id !== null && product.id !== undefined ? String(product.id) : null

      position += 1
      lines.push({
        kind: 'item',
        position,
        articleId,
        name: product.name,
        quantity: String(product.quantity),
        unit: 'piece',
        unitPrice,
        amount,
        taxCode: null,
      })
    }

    if (lineError) {
      skipped.push({ externalId, reason: lineError.reason, detail: lineError.detail })
      continue
    }

    if (receipt.discounts !== null && receipt.discounts !== undefined) {
      if (!Array.isArray(receipt.discounts)) {
        skipped.push({
          externalId,
          reason: 'malformed',
          detail: 'Receipt discounts must be an array or null',
        })
        continue
      }

      for (const discount of receipt.discounts) {
        if (!isRecord(discount) || typeof discount.name !== 'string') {
          lineError = { reason: 'malformed', detail: 'Discount entry is malformed' }
          break
        }
        const amount = readMoneyField(discount.amount)
        if (amount === null) {
          lineError = { reason: 'invalid_amount', detail: `Invalid discount amount for ${discount.name}` }
          break
        }

        position += 1
        lines.push({
          kind: 'discount',
          position,
          name: discount.name,
          amount,
          promotionId: null,
        })
      }

      if (lineError) {
        skipped.push({ externalId, reason: lineError.reason, detail: lineError.detail })
        continue
      }
    }

    const payments: { method: string; amount: string }[] = []
    if (receipt.payments !== null && receipt.payments !== undefined) {
      if (!Array.isArray(receipt.payments)) {
        skipped.push({
          externalId,
          reason: 'malformed',
          detail: 'Receipt payments must be an array',
        })
        continue
      }

      for (const payment of receipt.payments) {
        if (!isRecord(payment) || typeof payment.method !== 'string') {
          lineError = { reason: 'malformed', detail: 'Payment entry is malformed' }
          break
        }
        const amount = readMoneyField(payment.amount)
        if (amount === null) {
          lineError = { reason: 'invalid_amount', detail: `Invalid payment amount for ${payment.method}` }
          break
        }
        payments.push({ method: payment.method, amount })
      }

      if (lineError) {
        skipped.push({ externalId, reason: lineError.reason, detail: lineError.detail })
        continue
      }
    }

    const lineSum = sumAmounts(lines.map((line) => line.amount))
    const balanced = amountsEqual(lineSum, total)

    receipts.push({
      source: 'ah_be',
      externalId,
      occurredAt,
      store: null,
      currency: 'EUR',
      total,
      payments,
      lines,
      balanced,
      raw: receipt,
    })
  }

  for (const summaryId of summaryById.keys()) {
    if (!seenSummaryIds.has(summaryId)) {
      skipped.push({
        externalId: summaryId,
        reason: 'missing_detail',
        detail: 'Summary has no matching receipt detail',
      })
    }
  }

  return { source: 'ah_be', receipts, skipped }
}
