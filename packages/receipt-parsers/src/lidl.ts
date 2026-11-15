import { brusselsLocalToUtc } from './date'
import {
  amountsEqual,
  normalizeCommaMoney,
  normalizeMoneyString,
  normalizeQuantity,
  sumAmounts,
} from './decimal'
import { extractSpans, hasClass, parseAttributes } from './html'
import {
  ReceiptFormatError,
  type ParsedReceipt,
  type ReceiptLine,
  type ReceiptParseResult,
  type SkippedReceipt,
} from './types'

const ARTICLE_AMOUNT_RE = /(-?\d+,\d{1,2})\s+([A-Z])\s*$/
const TRAILING_SIGNED_AMOUNT_RE = /(-?\d+,\d{1,2})\s*$/
const TRAILING_NEGATIVE_AMOUNT_RE = /(-\d+,\d{1,2})\s*$/

const PURCHASE_LIST_OPEN_RE = /<span\b[^>]*\bclass\s*=\s*(?:"[^"]*\bpurchase_list\b[^"]*"|'[^']*\bpurchase_list\b[^']*')[^>]*>/i
const PURCHASE_SUMMARY_OPEN_RE = /<span\b[^>]*\bclass\s*=\s*(?:"[^"]*\bpurchase_summary\b[^"]*"|'[^']*\bpurchase_summary\b[^']*')[^>]*>/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isLidlReceiptData(json: unknown): boolean {
  if (!isRecord(json) || !Array.isArray(json.tickets)) return false
  return json.tickets.some(
    (entry) =>
      isRecord(entry) &&
      isRecord(entry.ticket) &&
      typeof entry.ticket.htmlPrintedReceipt === 'string',
  )
}

interface LidlHtmlParseOutcome {
  ok: true
  total: string
  payments: { method: string; amount: string }[]
  lines: ReceiptLine[]
}

interface LidlHtmlParseError {
  ok: false
  reason: 'invalid_amount' | 'malformed'
  detail: string
}

function parseLidlHtml(html: string): LidlHtmlParseOutcome | LidlHtmlParseError {
  const listMatch = PURCHASE_LIST_OPEN_RE.exec(html)
  const summaryMatch = PURCHASE_SUMMARY_OPEN_RE.exec(html)
  if (!listMatch || !summaryMatch || summaryMatch.index <= listMatch.index) {
    return {
      ok: false,
      reason: 'malformed',
      detail: 'Missing purchase_list or purchase_summary section in htmlPrintedReceipt',
    }
  }

  const listFragment = html.slice(listMatch.index + listMatch[0].length, summaryMatch.index)
  const summaryFragment = html.slice(summaryMatch.index)

  // Extract total from data-receipt-total in purchase_summary
  const totalAttrMatch = /data-receipt-total\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(summaryFragment)
  if (!totalAttrMatch) {
    return { ok: false, reason: 'malformed', detail: 'Missing data-receipt-total attribute' }
  }
  const rawTotal = (totalAttrMatch[1] ?? totalAttrMatch[2] ?? '').trim()
  const total = normalizeMoneyString(rawTotal)
  if (total === null) {
    return { ok: false, reason: 'invalid_amount', detail: `Invalid receipt total: ${rawTotal}` }
  }

  // Extract payment from data-tender-description span in purchase_summary
  const payments: { method: string; amount: string }[] = []
  const tenderSpanRe = /<span\b([^>]*\bdata-tender-description\b[^>]*)>([\s\S]*?)<\/span>/gi
  let tenderMatch: RegExpExecArray | null
  while ((tenderMatch = tenderSpanRe.exec(summaryFragment)) !== null) {
    const attrs = parseAttributes(tenderMatch[1])
    const method = (attrs['data-tender-description'] ?? '').trim()
    const amountMatch = TRAILING_SIGNED_AMOUNT_RE.exec(tenderMatch[2].trim())
    if (!amountMatch) {
      return { ok: false, reason: 'invalid_amount', detail: 'Invalid tender amount in payment line' }
    }
    const amount = normalizeCommaMoney(amountMatch[1])
    if (amount === null) {
      return { ok: false, reason: 'invalid_amount', detail: `Invalid tender amount: ${amountMatch[1]}` }
    }
    if (method) {
      payments.push({ method, amount })
    }
  }

  // Parse item and discount lines inside purchase_list
  const spans = extractSpans(listFragment)
  const lines: ReceiptLine[] = []
  let position = 0

  for (const span of spans) {
    if (hasClass(span.attrs, 'currency')) {
      continue
    }

    const trimmedText = span.text.trim()

    if (hasClass(span.attrs, 'article')) {
      const amountMatch = ARTICLE_AMOUNT_RE.exec(trimmedText)
      if (!amountMatch) {
        // Continuation line (e.g. "1,082 kg x 1,29 €/kg") has no trailing amount + tax code.
        continue
      }

      const amount = normalizeCommaMoney(amountMatch[1])
      if (amount === null) {
        return { ok: false, reason: 'invalid_amount', detail: `Invalid article amount: ${amountMatch[1]}` }
      }

      const rawQtyAttr = (span.attrs['data-art-quantity'] ?? '').trim()
      const rawQty = rawQtyAttr === '' ? '1' : rawQtyAttr
      const quantity = normalizeQuantity(rawQty)
      if (quantity === null) {
        return { ok: false, reason: 'malformed', detail: `Invalid article quantity: ${rawQty}` }
      }

      const unit: 'piece' | 'kg' = quantity.includes('.') ? 'kg' : 'piece'

      const rawUnitPrice = (span.attrs['data-unit-price'] ?? '').trim()
      let unitPrice: string | null = null
      if (rawUnitPrice !== '') {
        unitPrice = normalizeCommaMoney(rawUnitPrice)
        if (unitPrice === null) {
          return { ok: false, reason: 'invalid_amount', detail: `Invalid unit price: ${rawUnitPrice}` }
        }
      }

      const rawArtId = (span.attrs['data-art-id'] ?? '').trim()
      const articleId = rawArtId === '' ? null : rawArtId

      const rawDesc = (span.attrs['data-art-description'] ?? '').trim()
      const name = rawDesc !== '' ? rawDesc : trimmedText.slice(0, amountMatch.index).trim()

      const rawTaxType = (span.attrs['data-tax-type'] ?? '').trim()
      const taxCode = rawTaxType !== '' ? rawTaxType : amountMatch[2]

      position += 1
      lines.push({
        kind: 'item',
        position,
        articleId,
        name,
        quantity,
        unit,
        unitPrice,
        amount,
        taxCode,
      })
      continue
    }

    const isClassDiscount = hasClass(span.attrs, 'discount')
    const hasNoClass = !span.attrs['class'] || span.attrs['class'].trim() === ''
    const discountMatch = isClassDiscount
      ? TRAILING_SIGNED_AMOUNT_RE.exec(trimmedText)
      : hasNoClass
        ? TRAILING_NEGATIVE_AMOUNT_RE.exec(trimmedText)
        : null

    if (discountMatch) {
      const amount = normalizeCommaMoney(discountMatch[1])
      if (amount === null) {
        return { ok: false, reason: 'invalid_amount', detail: `Invalid discount amount: ${discountMatch[1]}` }
      }
      const name = trimmedText.slice(0, discountMatch.index).trim()
      const rawPromo = (span.attrs['data-promotion-id'] ?? '').trim()
      const promotionId = rawPromo === '' ? null : rawPromo

      position += 1
      lines.push({
        kind: 'discount',
        position,
        name,
        amount,
        promotionId,
      })
    }
  }

  return { ok: true, total, payments, lines }
}

/** Parse a Belgian Lidl receipt export JSON object. */
export function parseLidlReceipts(json: unknown): ReceiptParseResult {
  if (!isRecord(json) || !Array.isArray(json.tickets)) {
    throw new ReceiptFormatError('Expected Lidl receipt export with a tickets array')
  }

  const receipts: ParsedReceipt[] = []
  const skipped: SkippedReceipt[] = []

  for (const entry of json.tickets) {
    if (!isRecord(entry) || !isRecord(entry.ticket)) {
      skipped.push({
        externalId: null,
        reason: 'malformed',
        detail: 'Ticket entry is missing ticket object',
      })
      continue
    }

    const ticket = entry.ticket
    const externalId = typeof ticket.id === 'string' && ticket.id.trim() !== '' ? ticket.id : null
    if (externalId === null) {
      skipped.push({
        externalId: null,
        reason: 'malformed',
        detail: 'Ticket is missing a valid string id',
      })
      continue
    }

    if (ticket.isDeleted === true) {
      skipped.push({
        externalId,
        reason: 'deleted',
        detail: 'Ticket is marked as deleted',
      })
      continue
    }

    if (typeof ticket.htmlPrintedReceipt !== 'string' || ticket.htmlPrintedReceipt.trim() === '') {
      skipped.push({
        externalId,
        reason: 'missing_detail',
        detail: 'Ticket is missing htmlPrintedReceipt',
      })
      continue
    }

    const occurredAt = brusselsLocalToUtc(ticket.date)
    if (occurredAt === null) {
      skipped.push({
        externalId,
        reason: 'invalid_date',
        detail: `Invalid ticket date: ${String(ticket.date)}`,
      })
      continue
    }

    const parsedHtml = parseLidlHtml(ticket.htmlPrintedReceipt)
    if (!parsedHtml.ok) {
      skipped.push({
        externalId,
        reason: parsedHtml.reason,
        detail: parsedHtml.detail,
      })
      continue
    }

    const store =
      isRecord(ticket.store) && typeof ticket.store.name === 'string' && ticket.store.name !== ''
        ? ticket.store.name
        : null

    const lineSum = sumAmounts(parsedHtml.lines.map((line) => line.amount))
    const balanced = amountsEqual(lineSum, parsedHtml.total)

    receipts.push({
      source: 'lidl_be',
      externalId,
      occurredAt,
      store,
      currency: 'EUR',
      total: parsedHtml.total,
      payments: parsedHtml.payments,
      lines: parsedHtml.lines,
      balanced,
      raw: entry,
    })
  }

  return { source: 'lidl_be', receipts, skipped }
}
