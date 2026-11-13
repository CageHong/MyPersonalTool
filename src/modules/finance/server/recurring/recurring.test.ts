import assert from 'node:assert/strict'
import { test } from 'node:test'
import { matchScheduled } from './index'
import type { ScheduledItem } from './index'

const rent: ScheduledItem = {
  id: 1,
  accountId: 30,
  payeeId: 7,
  amountMin: 50000,
  amountMax: 52000,
  currency: 'EUR',
  startsOn: '2030-01-01',
  endsOn: '2030-12-31',
}
const at = (date: string) => `${date}T08:00:00Z`
const candidate = { payeeId: 7, currency: 'EUR', amount: 51000, occurredAt: at('2030-03-01') }

test('收款人、幣別、金額、日期都符合才配對', () => {
  assert.deepEqual(matchScheduled([rent], candidate), { status: 'matched', item: rent })
  assert.equal(matchScheduled([rent], { ...candidate, payeeId: 8 }).status, 'none')
  assert.equal(matchScheduled([rent], { ...candidate, currency: 'USD' }).status, 'none')
  assert.equal(matchScheduled([rent], { ...candidate, amount: 49999 }).status, 'none')
  assert.equal(matchScheduled([rent], { ...candidate, amount: 52001 }).status, 'none')
  assert.equal(matchScheduled([rent], { ...candidate, occurredAt: at('2029-12-31') }).status, 'none')
  assert.equal(matchScheduled([rent], { ...candidate, occurredAt: at('2031-01-01') }).status, 'none')
})

test('範圍的邊界算在內;沒有設定日期就不限', () => {
  assert.equal(matchScheduled([rent], { ...candidate, amount: 50000 }).status, 'matched')
  assert.equal(matchScheduled([rent], { ...candidate, occurredAt: at('2030-12-31') }).status, 'matched')
  const open = { ...rent, startsOn: null, endsOn: null }
  assert.equal(matchScheduled([open], { ...candidate, occurredAt: at('2040-06-01') }).status, 'matched')
})

test('同時符合兩個項目時不配對,回報兩個項目', () => {
  const other = { ...rent, id: 2, accountId: 31 }
  assert.deepEqual(matchScheduled([rent, other], candidate), { status: 'ambiguous', itemIds: [1, 2] })
})
