import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseLidlReceipts } from './lidl'
import { ReceiptFormatError } from './types'

const SAMPLE_HTML = `
<span class="purchase_list"><span id="purchase_list_line_1" class="currency" data-currency="€">Bedrag in EUR                    &euro;  </span>
<span id="purchase_list_line_2" class="article" data-art-id="0011111" data-art-quantity="1,082" data-unit-price="1,29" data-tax-type="B" data-art-description="Fictieve appels">Fictieve appels                      1,40 B</span>
<span id="purchase_list_line_3" class="article" data-art-id="0011111" data-art-quantity="1,082" data-unit-price="1,29" data-tax-type="B" data-art-description="Fictieve appels">  1,082 kg x 1,29   €/kg  </span>
<span id="purchase_list_line_4" class="discount" data-promotion-id="900000001-BE-FICTIEF-1">     Lidl Plus korting                     -0,32</span>
<span id="purchase_list_line_5" class="article" data-art-id="7400001" data-art-quantity="2" data-unit-price="2,39" data-tax-type="B" data-art-description="Fictief brood">Fictief brood      2,39 B    2     4,78 B</span>
<span id="purchase_list_line_6">Korting                            -1,00</span>
</span><span class="purchase_summary"><span id="purchase_summary_2" data-receipt-total="4.86" data-promotion-id="">Totaal                3 art.  </span>
<span id="purchase_summary_4" data-tender-description="Betaalkaart">Betaalkaart                         4,86</span>
<span id="purchase_summary_6">U bespaarde                         1,32</span>
</span>
`

describe('parseLidlReceipts', () => {
  it('parses weighed continuation lines, classless discounts, payments, and summary total', () => {
    const rawEntry = {
      ticket: {
        id: 'lidl-fict-001',
        date: '2026-01-15T14:05:12',
        totalAmount: 0,
        isDeleted: false,
        store: { name: 'Fictief Markt Centrum', locality: 'Brussel' },
        htmlPrintedReceipt: SAMPLE_HTML,
      },
    }

    const result = parseLidlReceipts({
      country: 'BE',
      summaries: [{ id: 'lidl-fict-001', date: '2026-01-15T14:05:12+00:00', totalAmount: 9.99 }],
      tickets: [rawEntry],
    })

    assert.equal(result.source, 'lidl_be')
    assert.equal(result.skipped.length, 0)
    assert.equal(result.receipts.length, 1)

    const receipt = result.receipts[0]
    assert.equal(receipt.externalId, 'lidl-fict-001')
    // Winter time in Europe/Brussels (CET = UTC+1)
    assert.equal(receipt.occurredAt, '2026-01-15T13:05:12+00:00')
    assert.equal(receipt.store, 'Fictief Markt Centrum')
    assert.equal(receipt.currency, 'EUR')
    assert.equal(receipt.total, '4.86')
    assert.equal(receipt.balanced, true)
    assert.deepEqual(receipt.payments, [{ method: 'Betaalkaart', amount: '4.86' }])
    assert.equal(receipt.raw, rawEntry)

    assert.deepEqual(receipt.lines, [
      {
        kind: 'item',
        position: 1,
        articleId: '0011111',
        name: 'Fictieve appels',
        quantity: '1.082',
        unit: 'kg',
        unitPrice: '1.29',
        amount: '1.40',
        taxCode: 'B',
      },
      {
        kind: 'discount',
        position: 2,
        name: 'Lidl Plus korting',
        amount: '-0.32',
        promotionId: '900000001-BE-FICTIEF-1',
      },
      {
        kind: 'item',
        position: 3,
        articleId: '7400001',
        name: 'Fictief brood',
        quantity: '2',
        unit: 'piece',
        unitPrice: '2.39',
        amount: '4.78',
        taxCode: 'B',
      },
      {
        kind: 'discount',
        position: 4,
        name: 'Korting',
        amount: '-1.00',
        promotionId: null,
      },
    ])

    // Ensure "U bespaarde 1,32" from purchase_summary is not included anywhere
    const serialized = JSON.stringify(receipt.lines)
    assert.equal(serialized.includes('bespaarde'), false)
    assert.equal(serialized.includes('1.32'), false)
  })

  it('converts Europe/Brussels summer time (CEST = UTC+2) to UTC', () => {
    const result = parseLidlReceipts({
      tickets: [
        {
          ticket: {
            id: 'lidl-fict-summer',
            date: '2026-07-15T14:05:12',
            isDeleted: false,
            htmlPrintedReceipt: SAMPLE_HTML,
          },
        },
      ],
    })

    assert.equal(result.receipts[0].occurredAt, '2026-07-15T12:05:12+00:00')
    assert.equal(result.receipts[0].store, null)
  })

  it('decodes HTML entities in attributes and line text', () => {
    const html = `
<span class="purchase_list">
<span class="article" data-art-id="5550001" data-art-quantity="1" data-unit-price="3,50" data-tax-type="A" data-art-description="Kaas &amp; Kruiden &quot;Speciaal&quot;">Kaas &amp; Kruiden 3,50 A</span>
<span class="discount" data-promotion-id="">Actie &amp; Korting -0,50</span>
</span><span class="purchase_summary"><span data-receipt-total="3.00">Totaal</span></span>
`
    const result = parseLidlReceipts({
      tickets: [
        {
          ticket: {
            id: 'lidl-fict-ent',
            date: '2026-02-10T10:00:00',
            isDeleted: false,
            htmlPrintedReceipt: html,
          },
        },
      ],
    })

    assert.equal(result.receipts[0].lines[0].name, 'Kaas & Kruiden "Speciaal"')
    assert.deepEqual(result.receipts[0].lines[1], {
      kind: 'discount',
      position: 2,
      name: 'Actie & Korting',
      amount: '-0.50',
      promotionId: null,
    })
  })

  it('marks balanced as false when line amounts do not equal data-receipt-total', () => {
    const unbalancedHtml = SAMPLE_HTML.replace('data-receipt-total="4.86"', 'data-receipt-total="5.00"')
    const result = parseLidlReceipts({
      tickets: [
        {
          ticket: {
            id: 'lidl-fict-unbal',
            date: '2026-01-15T10:00:00',
            isDeleted: false,
            htmlPrintedReceipt: unbalancedHtml,
          },
        },
      ],
    })

    assert.equal(result.receipts.length, 1)
    assert.equal(result.receipts[0].total, '5.00')
    assert.equal(result.receipts[0].balanced, false)
  })

  it('skips deleted tickets and tickets missing htmlPrintedReceipt', () => {
    const result = parseLidlReceipts({
      tickets: [
        {
          ticket: {
            id: 'lidl-fict-del',
            date: '2026-01-15T10:00:00',
            isDeleted: true,
            htmlPrintedReceipt: SAMPLE_HTML,
          },
        },
        {
          ticket: {
            id: 'lidl-fict-nohtml',
            date: '2026-01-15T10:00:00',
            isDeleted: false,
          },
        },
      ],
    })

    assert.equal(result.receipts.length, 0)
    assert.deepEqual(
      result.skipped.map((s) => ({ externalId: s.externalId, reason: s.reason })),
      [
        { externalId: 'lidl-fict-del', reason: 'deleted' },
        { externalId: 'lidl-fict-nohtml', reason: 'missing_detail' },
      ],
    )
  })

  it('throws ReceiptFormatError when top-level shape is invalid', () => {
    assert.throws(() => parseLidlReceipts(null), ReceiptFormatError)
    assert.throws(() => parseLidlReceipts({}), ReceiptFormatError)
    assert.throws(() => parseLidlReceipts({ tickets: 'not-array' }), ReceiptFormatError)
  })
})
