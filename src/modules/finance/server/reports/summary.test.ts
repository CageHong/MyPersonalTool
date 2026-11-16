import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sql } from 'drizzle-orm'
import { applyMigrations, openDb } from '../../db/index'
import { summarizeTransactions } from './summary'

// 虛構的帳本:拆帳、週期項目(固定)、收入、退款、外幣、帶手續費的轉帳、缺匯率(JPY 沒有任何匯率)、期初餘額
function freshDb() {
  const db = openDb(':memory:')
  applyMigrations(db)
  const at = '2026-01-01T00:00:00Z'
  db.run(sql`INSERT INTO finance_currencies VALUES ('EUR', 2, 'Euro'), ('USD', 2, 'US Dollar'), ('JPY', 0, 'Yen')`)
  db.run(sql`INSERT INTO finance_settings VALUES ('display_currency', 'EUR')`)
  db.run(sql`INSERT INTO finance_fx_rates VALUES ('2026-01-01', 'USD', 0.9, 'test', ${at})`)
  db.run(sql`INSERT INTO finance_accounts (id, name, type, subtype, currency, created_at) VALUES
             (1, 'Bank', 'asset', 'bank', 'EUR', ${at}),
             (2, 'Wallet', 'asset', 'bank', 'USD', ${at}),
             (3, 'Deposit', 'asset', 'deposit', 'EUR', ${at}),
             (4, 'Yen cash', 'asset', 'cash', 'JPY', ${at})`)
  db.run(sql`INSERT INTO finance_accounts (id, name, type, is_system, created_at) VALUES
             (20, '未分類', 'expense', 1, ${at}), (21, '未分類收入', 'income', 1, ${at}),
             (22, '手續費', 'expense', 1, ${at}), (23, '換匯', 'equity', 1, ${at}),
             (24, '期初餘額', 'equity', 1, ${at})`)
  db.run(sql`INSERT INTO finance_accounts (id, name, type, parent_id, created_at) VALUES
             (10, 'Food', 'expense', NULL, ${at}), (11, 'Transport', 'expense', NULL, ${at}),
             (12, 'Train', 'expense', 11, ${at}), (13, 'Salary', 'income', NULL, ${at})`)
  db.run(sql`INSERT INTO finance_payees (id, name, created_at) VALUES (1, 'Rail Co', ${at})`)
  db.run(sql`INSERT INTO finance_scheduled_transactions
             (id, name, account_id, payee_id, amount_min, amount_max, currency, frequency, created_at)
             VALUES (1, 'Rail pass', 12, 1, 1000, 1500, 'EUR', 'monthly', ${at})`)
  const tx = (id: number, when: string, scheduled: number | null = null) =>
    db.run(sql`INSERT INTO finance_transactions (id, occurred_at, scheduled_id, source, created_at, updated_at)
               VALUES (${id}, ${when}, ${scheduled}, 'manual', ${at}, ${at})`)
  tx(1, '2026-01-05T10:00:00Z')
  tx(2, '2026-01-06T10:00:00Z', 1)
  tx(3, '2026-01-07T10:00:00Z')
  tx(4, '2026-01-08T10:00:00Z')
  tx(5, '2026-01-09T10:00:00Z')
  tx(6, '2026-01-10T10:00:00Z')
  tx(7, '2025-12-01T10:00:00Z')
  tx(8, '2025-11-01T10:00:00Z')
  db.run(sql`INSERT INTO finance_postings (transaction_id, account_id, amount, currency, sort_order) VALUES
             (1, 1, -3000, 'EUR', 0), (1, 10, 2500, 'EUR', 1), (1, 11, 500, 'EUR', 2),
             (2, 1, -1200, 'EUR', 0), (2, 12, 1200, 'EUR', 1),
             (3, 1, 50000, 'EUR', 0), (3, 13, -50000, 'EUR', 1),
             (4, 1, 300, 'EUR', 0), (4, 10, -300, 'EUR', 1),
             (5, 2, -1000, 'USD', 0), (5, 10, 1000, 'USD', 1),
             (6, 1, -10100, 'EUR', 0), (6, 3, 10000, 'EUR', 1), (6, 22, 100, 'EUR', 2),
             (7, 4, -700, 'JPY', 0), (7, 10, 700, 'JPY', 1),
             (8, 1, 100000, 'EUR', 0), (8, 24, -100000, 'EUR', 1)`)
  return db
}

test('沒有篩選:支出分固定 / 變動,退款沖減、外幣換算、轉帳的手續費算支出;缺匯率的整筆不算', () => {
  const s = summarizeTransactions(freshDb(), { order: 'desc' })
  // 變動 = Food 2500 − 300 + 900(1000 USD × 0.9)+ Transport 500 + 手續費 100;固定 = 週期項目的 Train 1200
  assert.deepEqual(s.expense, { total: 4900, fixed: 1200, variable: 3700 })
  assert.equal(s.income, 50000)
  assert.equal(s.net, 45100)
  assert.equal(s.currency, 'EUR')
  assert.equal(s.transactionCount, 6)
  assert.equal(s.missingRate, 1)
})

test('各分類:上層含子分類,依金額由大到小;收入分開列', () => {
  const s = summarizeTransactions(freshDb(), { order: 'desc' })
  assert.deepEqual(s.expenseCategories, [
    { id: 10, name: 'Food', amount: 3100, children: [] },
    { id: 11, name: 'Transport', amount: 1700, children: [{ id: 12, name: 'Train', amount: 1200 }] },
    { id: 22, name: '手續費', amount: 100, children: [] },
  ])
  assert.deepEqual(s.incomeCategories, [{ id: 13, name: 'Salary', amount: 50000, children: [] }])
})

test('分類篩選:只加總那個分類(含子分類)的分錄,拆帳交易的其他分類不算', () => {
  const food = summarizeTransactions(freshDb(), { order: 'desc', categoryId: 10 })
  assert.deepEqual(food.expense, { total: 3100, fixed: 0, variable: 3100 })
  assert.equal(food.transactionCount, 3)
  assert.equal(food.income, 0)
  const transport = summarizeTransactions(freshDb(), { order: 'desc', categoryId: 11 })
  assert.deepEqual(transport.expense, { total: 1700, fixed: 1200, variable: 500 })
})

test('其他篩選照交易清單:日期範圍', () => {
  const s = summarizeTransactions(freshDb(), { order: 'desc', from: '2026-01-07', to: '2026-01-08' })
  assert.deepEqual(s.expense, { total: -300, fixed: 0, variable: -300 })
  assert.equal(s.income, 50000)
  assert.equal(s.transactionCount, 2)
})

test('外幣:同一格先加總再取整數', () => {
  const db = freshDb()
  // 兩筆 5 美分的 Food:各 4.5 歐分,合起來 9(各自取整數會是 10)
  db.run(sql`INSERT INTO finance_transactions (id, occurred_at, source, created_at, updated_at) VALUES
             (20, '2026-02-01T10:00:00Z', 'manual', 'x', 'x'), (21, '2026-02-02T10:00:00Z', 'manual', 'x', 'x')`)
  db.run(sql`INSERT INTO finance_postings (transaction_id, account_id, amount, currency, sort_order) VALUES
             (20, 2, -5, 'USD', 0), (20, 10, 5, 'USD', 1), (21, 2, -5, 'USD', 0), (21, 10, 5, 'USD', 1)`)
  const s = summarizeTransactions(db, { order: 'desc', from: '2026-02-01' })
  assert.equal(s.expense.total, 9)
})
