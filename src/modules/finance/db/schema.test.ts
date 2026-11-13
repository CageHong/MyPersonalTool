import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sql } from 'drizzle-orm'
import { applyMigrations, openDb } from './index'

function freshDb() {
  const db = openDb(':memory:')
  applyMigrations(db)
  db.run(sql`INSERT INTO finance_currencies VALUES ('EUR', 2, 'Euro'), ('USD', 2, 'US Dollar')`)
  db.run(sql`INSERT INTO finance_accounts (id, name, type, currency, created_at)
             VALUES (1, 'Bank', 'asset', 'EUR', '2026-01-01T00:00:00Z')`)
  db.run(sql`INSERT INTO finance_accounts (id, name, type, created_at)
             VALUES (2, 'Food', 'expense', '2026-01-01T00:00:00Z')`)
  db.run(sql`INSERT INTO finance_transactions (id, occurred_at, source, created_at, updated_at)
             VALUES (1, '2026-01-01T00:00:00Z', 'manual', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`)
  return db
}

// Drizzle 把 SQLite 的錯誤包在 cause 裡
function currencyMismatch(error: unknown) {
  const cause = (error as { cause?: unknown }).cause
  return cause instanceof Error && /posting currency does not match account currency/.test(cause.message)
}

test('migration 可以套用在空的資料庫', () => {
  const db = freshDb()
  const tables = db.all<{ n: number }>(
    sql`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name LIKE 'finance_%'`,
  )
  assert.equal(tables[0].n, 15)
})

test('分錄幣別與帳戶幣別不同時,新增與修改都被擋下', () => {
  const db = freshDb()
  assert.throws(
    () => db.run(sql`INSERT INTO finance_postings (transaction_id, account_id, amount, currency) VALUES (1, 1, 100, 'USD')`),
    currencyMismatch,
  )
  db.run(sql`INSERT INTO finance_postings (id, transaction_id, account_id, amount, currency) VALUES (1, 1, 1, -100, 'EUR')`)
  assert.throws(
    () => db.run(sql`UPDATE finance_postings SET currency = 'USD' WHERE id = 1`),
    currencyMismatch,
  )
})

test('分類帳戶沒有固定幣別,可以收任何幣別的分錄', () => {
  const db = freshDb()
  db.run(sql`INSERT INTO finance_postings (transaction_id, account_id, amount, currency) VALUES (1, 2, 100, 'USD')`)
})

test('借貸不平的交易會出現在 finance_v_unbalanced', () => {
  const db = freshDb()
  db.run(sql`INSERT INTO finance_postings (transaction_id, account_id, amount, currency) VALUES (1, 1, -100, 'EUR'), (1, 2, 90, 'EUR')`)
  const rows = db.all<{ residual: number }>(sql`SELECT residual FROM finance_v_unbalanced`)
  assert.deepEqual(rows.map((r) => r.residual), [-10])
})

test('同類型、同一層內帳戶名稱不可重複;不同層可以', () => {
  const db = freshDb()
  assert.throws(() =>
    db.run(sql`INSERT INTO finance_accounts (name, type, created_at) VALUES ('Food', 'expense', '2026-01-01T00:00:00Z')`),
  )
  db.run(sql`INSERT INTO finance_accounts (name, type, parent_id, created_at) VALUES ('Food', 'expense', 2, '2026-01-01T00:00:00Z')`)
})

test('只有 asset / liability 可以放進群組', () => {
  const db = freshDb()
  db.run(sql`INSERT INTO finance_account_groups (id, name, created_at) VALUES (1, 'G', '2026-01-01T00:00:00Z')`)
  db.run(sql`UPDATE finance_accounts SET group_id = 1 WHERE id = 1`)
  assert.throws(() => db.run(sql`UPDATE finance_accounts SET group_id = 1 WHERE id = 2`))
})

test('直接報價只能存 base < quote 的方向', () => {
  const db = freshDb()
  db.run(sql`INSERT INTO finance_fx_direct_quotes VALUES ('2026-01-01', 'EUR', 'USD', 1.1, 'test', '2026-01-01T00:00:00Z')`)
  assert.throws(() =>
    db.run(sql`INSERT INTO finance_fx_direct_quotes VALUES ('2026-01-01', 'USD', 'EUR', 0.9, 'test', '2026-01-01T00:00:00Z')`),
  )
})

test('規則:payee 規則要有 payee_id,source_category 規則要有 match_value', () => {
  const db = freshDb()
  db.run(sql`INSERT INTO finance_payees (id, name, created_at) VALUES (1, 'Shop', '2026-01-01T00:00:00Z')`)
  db.run(sql`INSERT INTO finance_rules (match_field, payee_id, assign_account_id, created_at) VALUES ('payee', 1, 2, '2026-01-01T00:00:00Z')`)
  db.run(sql`INSERT INTO finance_rules (match_field, match_value, assign_account_id, created_at) VALUES ('source_category', 'Groceries', 2, '2026-01-01T00:00:00Z')`)
  assert.throws(() =>
    db.run(sql`INSERT INTO finance_rules (match_field, match_value, assign_account_id, created_at) VALUES ('payee', 'Shop', 2, '2026-01-01T00:00:00Z')`),
  )
})
