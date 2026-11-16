import assert from 'node:assert/strict'
import { test } from 'node:test'
import { monthlyReport } from './monthly'
import { scheduledReport } from './scheduled'
import { reportFixture as freshDb } from './testing'
import { tripReport } from './trips'

test('固定支出:每個項目的筆數、合計、每月平均、最近一筆;停用又沒有交易的不列', () => {
  const r = scheduledReport(freshDb(), { order: 'desc', from: '2026-01-01', to: '2026-02-28' })
  assert.deepEqual(
    r.items.map((i) => [i.name, i.isActive, i.count, i.total, i.perMonth, i.lastAt]),
    [
      ['Rent', true, 2, 100000, 50000, '2026-02-01T09:00:00Z'],
      ['Phone', true, 1, 1234, 617, '2026-01-20T09:00:00Z'],
      ['Old phone', false, 1, 900, 450, '2026-01-05T09:00:00Z'],
    ],
  )
  assert.deepEqual(r.items[0].category, { id: 11, name: 'Rent', parentName: 'Home' })
  assert.equal(r.items[0].payee, 'Landlord')
  assert.equal(r.months, 2)
  assert.equal(r.total, 102134)
  assert.equal(r.perMonth, 51067)
})

test('固定支出的合計 = 每月報表的固定支出', () => {
  const db = freshDb()
  const filter = { order: 'desc' as const, from: '2026-01-01', to: '2026-02-28' }
  assert.equal(scheduledReport(db, filter).total, monthlyReport(db, filter).total.expense.fixed)
})

test('期間只含一部分:沒有交易的啟用項目仍列出(0 筆)', () => {
  const r = scheduledReport(freshDb(), { order: 'desc', from: '2026-02-01', to: '2026-02-28' })
  assert.deepEqual(r.items.map((i) => [i.name, i.count, i.lastAt]), [['Rent', 1, '2026-02-01T09:00:00Z'], ['Phone', 0, null]])
})

test('旅行:有日期的標籤才算,依開始日期由新到舊;交易依標籤,不看日期範圍', () => {
  const r = tripReport(freshDb())
  assert.deepEqual(
    r.trips.map((t) => [t.name, t.startsOn, t.transactionCount, t.expense, t.income]),
    [
      ['Trip B', '2026-02-01', 1, 4000, 0],
      ['Trip A', '2026-01-10', 2, 2500, 1000],
    ],
  )
  assert.deepEqual(r.trips[1].expenseCategories, [{ id: 13, name: 'Food', amount: 2500, children: [] }])
  assert.equal(r.currency, 'EUR')
})
