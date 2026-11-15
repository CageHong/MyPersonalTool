import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { detectReceiptSource, parseReceipts, ReceiptFormatError } from './index'

describe('detectReceiptSource and parseReceipts', () => {
  it('detects and parses Lidl export', () => {
    const lidlJson = {
      tickets: [
        {
          ticket: {
            id: 'lidl-detect-1',
            date: '2026-01-10T11:00:00',
            isDeleted: false,
            htmlPrintedReceipt:
              '<span class="purchase_list"></span><span class="purchase_summary"><span data-receipt-total="0.00"></span></span>',
          },
        },
      ],
    }

    assert.equal(detectReceiptSource(lidlJson), 'lidl_be')
    const parsed = parseReceipts(lidlJson)
    assert.equal(parsed.source, 'lidl_be')
    assert.equal(parsed.receipts.length, 1)
  })

  it('detects and parses AH export', () => {
    const ahJson = {
      summaries: [
        { id: 'ah-detect-1', dateTime: '2026-01-10T11:00:00.000Z', totalAmount: { amount: 0 } },
      ],
      receipts: [{ id: 'ah-detect-1', products: [], discounts: null, payments: [] }],
    }

    assert.equal(detectReceiptSource(ahJson), 'ah_be')
    const parsed = parseReceipts(ahJson)
    assert.equal(parsed.source, 'ah_be')
    assert.equal(parsed.receipts.length, 1)
  })

  it('returns null on unrecognized shape and throws ReceiptFormatError in parseReceipts', () => {
    assert.equal(detectReceiptSource({ foo: 'bar' }), null)
    assert.equal(detectReceiptSource(null), null)
    assert.throws(() => parseReceipts({ foo: 'bar' }), ReceiptFormatError)
  })
})
