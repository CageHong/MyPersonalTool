import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dedupKey } from './dedup'
import type { PendingTransaction } from './types'

function pending(overrides: Partial<PendingTransaction>): PendingTransaction {
  return {
    source: 'wise_csv',
    externalId: null,
    occurredAt: '2030-01-15T09:30:00+00:00',
    kind: 'out',
    movements: [{ account: 'wise:EUR', currency: 'EUR', amount: '-12.30' }],
    fee: null,
    counterparty: null,
    reference: null,
    sourceCategory: null,
    line: 2,
    raw: {},
    ...overrides,
  }
}

test('有來源 ID 時只看來源與 ID', () => {
  const a = pending({ externalId: 'CARD-1001' })
  const b = pending({ externalId: 'CARD-1001', occurredAt: '2030-03-01T00:00:00+00:00' })
  assert.equal(dedupKey(a), 'wise_csv|id|CARD-1001')
  assert.equal(dedupKey(a), dedupKey(b))
  assert.notEqual(dedupKey(a), dedupKey(pending({ externalId: 'CARD-1002' })))
})

test('沒有 ID 時用 日期 + 金額 + 幣別;同一天不同時間、金額寫法不同視為相同', () => {
  const a = pending({})
  const b = pending({
    occurredAt: '2030-01-15T22:00:00+00:00',
    movements: [{ account: 'wise:EUR', currency: 'EUR', amount: '-12.3' }],
  })
  assert.equal(dedupKey(a), 'wise_csv|2030-01-15|-12.3|EUR')
  assert.equal(dedupKey(a), dedupKey(b))
})

test('沒有 ID 時,日期、金額、幣別任一個不同就不同', () => {
  const base = dedupKey(pending({}))
  assert.notEqual(base, dedupKey(pending({ occurredAt: '2030-01-16T09:30:00+00:00' })))
  assert.notEqual(
    base,
    dedupKey(pending({ movements: [{ account: 'wise:EUR', currency: 'EUR', amount: '12.30' }] })),
  )
  assert.notEqual(
    base,
    dedupKey(pending({ movements: [{ account: 'wise:USD', currency: 'USD', amount: '-12.30' }] })),
  )
})
