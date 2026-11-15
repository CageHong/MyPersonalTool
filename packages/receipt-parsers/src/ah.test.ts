import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseAhReceipts } from './ah'
import { ReceiptFormatError } from './types'

describe('parseAhReceipts', () => {
  it('parses products, discounts, payments, and UTC timestamps', () => {
    const rawReceipt = {
      id: 'ah-fict-001',
      products: [
        {
          id: 123,
          quantity: 2,
          name: 'FICTIEF BROOD',
          price: { amount: 1.99 },
          amount: { amount: 3.98 },
        },
        {
          id: 456,
          quantity: 1,
          name: 'FICTIEVE KAAS',
          price: null,
          amount: { amount: 4.5 },
        },
      ],
      discounts: [{ name: 'FICTIEVEKAAS', amount: { amount: -0.5 } }],
      payments: [{ method: 'PINNEN', amount: { amount: 7.98 } }],
    }

    const result = parseAhReceipts({
      fetchedAt: '2026-03-07T15:00:00.000Z',
      summaries: [
        {
          id: 'ah-fict-001',
          dateTime: '2026-03-07T14:05:00.000Z',
          totalAmount: { amount: 7.98 },
        },
      ],
      receipts: [rawReceipt],
    })

    assert.equal(result.source, 'ah_be')
    assert.equal(result.skipped.length, 0)
    assert.equal(result.receipts.length, 1)

    const receipt = result.receipts[0]
    assert.equal(receipt.externalId, 'ah-fict-001')
    assert.equal(receipt.occurredAt, '2026-03-07T14:05:00+00:00')
    assert.equal(receipt.store, null)
    assert.equal(receipt.currency, 'EUR')
    assert.equal(receipt.total, '7.98')
    assert.equal(receipt.balanced, true)
    assert.deepEqual(receipt.payments, [{ method: 'PINNEN', amount: '7.98' }])
    assert.equal(receipt.raw, rawReceipt)

    assert.deepEqual(receipt.lines, [
      {
        kind: 'item',
        position: 1,
        articleId: '123',
        name: 'FICTIEF BROOD',
        quantity: '2',
        unit: 'piece',
        unitPrice: '1.99',
        amount: '3.98',
        taxCode: null,
      },
      {
        kind: 'item',
        position: 2,
        articleId: '456',
        name: 'FICTIEVE KAAS',
        quantity: '1',
        unit: 'piece',
        unitPrice: null,
        amount: '4.50',
        taxCode: null,
      },
      {
        kind: 'discount',
        position: 3,
        name: 'FICTIEVEKAAS',
        amount: '-0.50',
        promotionId: null,
      },
    ])
  })

  it('handles discounts: null and unbalanced totals', () => {
    const result = parseAhReceipts({
      summaries: [
        {
          id: 'ah-fict-002',
          dateTime: '2026-04-01T09:30:00.000Z',
          totalAmount: { amount: 5.0 },
        },
      ],
      receipts: [
        {
          id: 'ah-fict-002',
          products: [
            { id: 789, quantity: 1, name: 'FICTIEF MELK', price: { amount: 1.5 }, amount: { amount: 1.5 } },
          ],
          discounts: null,
          payments: [],
        },
      ],
    })

    assert.equal(result.skipped.length, 0)
    assert.equal(result.receipts[0].lines.length, 1)
    assert.equal(result.receipts[0].balanced, false)
  })

  it('skips mismatched summaries/receipts as missing_detail and >2 decimal amounts as invalid_amount', () => {
    const result = parseAhReceipts({
      summaries: [
        {
          id: 'ah-only-summary',
          dateTime: '2026-04-01T09:30:00.000Z',
          totalAmount: { amount: 2.0 },
        },
        {
          id: 'ah-bad-amount',
          dateTime: '2026-04-01T09:30:00.000Z',
          totalAmount: { amount: 1.234 },
        },
      ],
      receipts: [
        {
          id: 'ah-only-receipt',
          products: [],
          discounts: null,
          payments: [],
        },
        {
          id: 'ah-bad-amount',
          products: [],
          discounts: null,
          payments: [],
        },
      ],
    })

    assert.equal(result.receipts.length, 0)
    assert.deepEqual(
      result.skipped.map((s) => ({ externalId: s.externalId, reason: s.reason })),
      [
        { externalId: 'ah-only-receipt', reason: 'missing_detail' },
        { externalId: 'ah-bad-amount', reason: 'invalid_amount' },
        { externalId: 'ah-only-summary', reason: 'missing_detail' },
      ],
    )
  })

  it('throws ReceiptFormatError when top-level shape is invalid', () => {
    assert.throws(() => parseAhReceipts('invalid'), ReceiptFormatError)
    assert.throws(() => parseAhReceipts({ summaries: [] }), ReceiptFormatError)
    assert.throws(() => parseAhReceipts({ receipts: [] }), ReceiptFormatError)
  })
})
