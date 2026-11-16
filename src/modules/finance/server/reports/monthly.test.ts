import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sql } from 'drizzle-orm'
import { applyMigrations, openDb } from '../../db/index'
import { monthlyReport } from './monthly'

// 虛構的帳本:一月(固定 + 變動 + 收入)、二月沒有交易、三月(變動)
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
             (12, 'Food', 'expense', NULL, ${at}), (13, 'Salary', 'income', NULL, ${at})`)
  db.run(sql`INSERT INTO finance_payees (id, name, created_at) VALUES (1, 'Landlord', ${at})`)
  db.run(sql`INSERT INTO finance_scheduled_transactions
             (id, name, account_id, payee_id, amount_min, amount_max, currency, frequency, created_at)
             VALUES (1, 'Rent', 11, 1, 50000, 50000, 'EUR', 'monthly', ${at})`)
  db.run(sql`INSERT INTO finance_transactions (id, occurred_at, scheduled_id, source, created_at, updated_at) VALUES
             (1, '2026-01-01T09:00:00Z', 1, 'manual', ${at}, ${at}),
             (2, '2026-01-15T09:00:00Z', NULL, 'manual', ${at}, ${at}),
             (3, '2026-01-25T09:00:00Z', NULL, 'manual', ${at}, ${at}),
             (4, '2026-03-03T09:00:00Z', NULL, 'manual', ${at}, ${at})`)
  db.run(sql`INSERT INTO finance_postings (transaction_id, account_id, amount, currency, sort_order) VALUES
             (1, 1, -50000, 'EUR', 0), (1, 11, 50000, 'EUR', 1),
             (2, 1, -3000, 'EUR', 0), (2, 12, 3000, 'EUR', 1),
             (3, 1, 200000, 'EUR', 0), (3, 13, -200000, 'EUR', 1),
             (4, 1, -4001, 'EUR', 0), (4, 12, 4001, 'EUR', 1)`)
  return db
}

test('每個月一列(含沒有交易的月份),合計與每月平均', () => {
  const r = monthlyReport(freshDb(), { order: 'desc', from: '2026-01-01', to: '2026-03-31' })
  assert.deepEqual(
    r.months.map((m) => [m.month, m.expense.fixed, m.expense.variable, m.income, m.net, m.transactionCount]),
    [
      ['2026-01', 50000, 3000, 200000, 147000, 3],
      ['2026-02', 0, 0, 0, 0, 0],
      ['2026-03', 0, 4001, 0, -4001, 1],
    ],
  )
  assert.deepEqual(r.total, { expense: { total: 57001, fixed: 50000, variable: 7001 }, income: 200000, net: 142999 })
  // 三個月平均,各自四捨五入
  assert.deepEqual(r.average, { expense: { total: 19000, fixed: 16667, variable: 2334 }, income: 66667, net: 47666 })
  assert.equal(r.from, '2026-01-01')
  assert.equal(r.to, '2026-03-31')
})

test('沒給期間:從第一筆到最後一筆交易的月份', () => {
  const r = monthlyReport(freshDb(), { order: 'desc' })
  assert.deepEqual(r.months.map((m) => m.month), ['2026-01', '2026-02', '2026-03'])
  assert.equal(r.from, '2026-01-01')
  assert.equal(r.to, '2026-03-03')
})

test('跨年的月份;各分類照期間摘要的規則', () => {
  const r = monthlyReport(freshDb(), { order: 'desc', from: '2025-11-01', to: '2026-01-31' })
  assert.deepEqual(r.months.map((m) => m.month), ['2025-11', '2025-12', '2026-01'])
  assert.deepEqual(r.expenseCategories, [
    { id: 10, name: 'Home', amount: 50000, children: [{ id: 11, name: 'Rent', amount: 50000 }] },
    { id: 12, name: 'Food', amount: 3000, children: [] },
  ])
})

test('帳本是空的:沒有月份', () => {
  const db = openDb(':memory:')
  applyMigrations(db)
  db.run(sql`INSERT INTO finance_accounts (id, name, type, is_system, created_at) VALUES
             (20, '未分類', 'expense', 1, 'x'), (21, '未分類收入', 'income', 1, 'x'),
             (22, '手續費', 'expense', 1, 'x'), (23, '換匯', 'equity', 1, 'x')`)
  const r = monthlyReport(db, { order: 'desc' })
  assert.deepEqual(r.months, [])
  assert.equal(r.total.expense.total, 0)
})
