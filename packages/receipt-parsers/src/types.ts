export type ReceiptSource = 'lidl_be' | 'ah_be'

export interface ReceiptItemLine {
  kind: 'item'
  position: number
  articleId: string | null
  name: string
  quantity: string
  unit: 'piece' | 'kg'
  unitPrice: string | null
  amount: string
  taxCode: string | null
}

export interface ReceiptDiscountLine {
  kind: 'discount'
  position: number
  name: string
  amount: string
  promotionId: string | null
}

export type ReceiptLine = ReceiptItemLine | ReceiptDiscountLine

export interface ParsedReceipt {
  source: ReceiptSource
  externalId: string
  occurredAt: string
  store: string | null
  currency: string
  total: string
  payments: { method: string; amount: string }[]
  lines: ReceiptLine[]
  balanced: boolean
  raw: unknown
}

export type ReceiptSkipReason =
  | 'deleted'
  | 'missing_detail'
  | 'invalid_amount'
  | 'invalid_date'
  | 'malformed'

export interface SkippedReceipt {
  externalId: string | null
  reason: ReceiptSkipReason
  detail: string
}

export interface ReceiptParseResult {
  source: ReceiptSource
  receipts: ParsedReceipt[]
  skipped: SkippedReceipt[]
}

export class ReceiptFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReceiptFormatError'
  }
}
