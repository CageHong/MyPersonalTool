import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sql } from 'drizzle-orm'
import { applyMigrations, openDb } from '../../db/index'
import { monthlyReport } from './monthly'
import { scheduledReport } from './scheduled'
import { tripReport } from './trips'

// 虛構的帳本:兩個啟用的週期項目(Rent 兩個月、Phone 一次)、一個停用沒交易的、一個停用有交易的;兩趟旅行標籤 + 一般標籤
function freshDb() {
  const db = openDb(':memory:')
  applyMigrations(db)
  const at = '2026-01-01T00:00:00Z'
  db.run(sql`INSERT INTO finance_currencies VALUES ('EUR', 2, 'Euro')`)
  db.run(sql`INSERT INTO finance_settings VALUES ('display_currency', 'EUR')`)
  db.run(sql`INSERT INTO finance_accounts (id, name, type, subtype, currency, created_at) VALUES (1, 'Bank', 'asset', 'bank', 'EUR', ${at})`)
  db.run(sql`INSERT INTO finance_accounts (id, name, type, is_system, created_at) VALUES
             (20, '未分類', 'expense', 1, ${at}), (21, '未分類收入', 'income', 1, ${at}),
             (22, '手續費', 'expense', 1, ${at}), (23, '換匯', 'equity', 1, ${at})`)
  db.run(sql`INSERT INTO finance_accounts (id, name, type, parent_id, created_at) VALUES
             (10, 'Home', 'expense', NULL, ${at}), (11, 'Rent', 'expense', 10, ${at}),
             (12, 'Phone', 'expense', 10, ${at}), (13, 'Food', 'expense', NULL, ${at}),
             (14, 'Refunds', 'income', NULL, ${at})`)
  db.run(sql`INSERT INTO finance_payees (id, name, created_at) VALUES (1, 'Landlord', ${at}), (2, 'Telco', ${at}), (3, 'Gym', ${at})`)
  db.run(sql`INSERT INTO finance_scheduled_transactions
             (id, name, account_id, payee_id, amount_min, amount_max, currency, frequency, is_active, created_at) VALUES
             (1, 'Rent', 11, 1, 50000, 50000, 'EUR', 'monthly', 1, ${at}),
             (2, 'Phone', 12, 2, 1000, 1500, 'EUR', 'monthly', 1, ${at}),
             (3, 'Gym', 13, 3, 2000, 2000, 'EUR', 'monthly', 0, ${at}),
             (4, 'Old phone', 12, 2, 900, 900, 'EUR', 'monthly', 0, ${at})`)
  db.run(sql`INSERT INTO finance_tags (id, name, starts_on, ends_on, created_at) VALUES
             (1, 'Trip A', '2026-01-10', '2026-01-12', ${at}), (2, 'Trip B', '2026-02-01', '2026-02-03', ${at}),
             (3, 'Work', NULL, NULL, ${at})`)
  const tx = (id: number, when: string, scheduled: number | null) =>
    db.run(sql`INSERT INTO finance_transactions (id, occurred_at, scheduled_id, source, created_at, updated_at)
               VALUES (${id}, ${when}, ${scheduled}, 'manual', ${at}, ${at})`)
  tx(1, '2026-01-01T09:00:00Z', 1)
  tx(2, '2026-02-01T09:00:00Z', 1)
  tx(3, '2026-01-20T09:00:00Z', 2)
  tx(4, '2026-01-05T09:00:00Z', 4)
  tx(5, '2026-01-11T09:00:00Z', null)
  tx(6, '2026-01-30T09:00:00Z', null)
  tx(7, '2026-02-02T09:00:00Z', null)
  db.run(sql`INSERT INTO finance_postings (transaction_id, account_id, amount, currency, sort_order) VALUES
             (1, 1, -50000, 'EUR', 0), (1, 11, 50000, 'EUR', 1),
             (2, 1, -50000, 'EUR', 0), (2, 11, 50000, 'EUR', 1),
             (3, 1, -1234, 'EUR', 0), (3, 12, 1234, 'EUR', 1),
             (4, 1, -900, 'EUR', 0), (4, 12, 900, 'EUR', 1),
             (5, 1, -2500, 'EUR', 0), (5, 13, 2500, 'EUR', 1),
             (6, 1, 1000, 'EUR', 0), (6, 14, -1000, 'EUR', 1),
             (7, 1, -4000, 'EUR', 0), (7, 13, 4000, 'EUR', 1)`)
  // 旅行 A:5、6(6 是晚了幾天才掛上的收入,標籤才算數,日期範圍不算);旅行 B:7
  db.run(sql`INSERT INTO finance_transaction_tags VALUES (5, 1), (6, 1), (7, 2), (5, 3)`)
  return db
}

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
