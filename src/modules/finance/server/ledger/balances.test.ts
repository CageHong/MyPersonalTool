import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sql } from 'drizzle-orm'
import { applyMigrations, openDb } from '../../db/index'
import { ValidationError } from '../errors'
import { NotBalanceAccountError, getAccountBalance, getAccountBalanceForInput, getAccountBalances } from './balances'

function freshDb() {
  const db = openDb(':memory:')
  applyMigrations(db)
  const at = '2026-01-01T00:00:00Z'
  db.run(sql`INSERT INTO finance_currencies VALUES ('EUR', 2, 'Euro'), ('TWD', 0, 'New Taiwan Dollar')`)
  db.run(sql`INSERT INTO finance_accounts (id, name, type, subtype, currency, created_at) VALUES
             (1, 'Bank', 'asset', 'bank', 'EUR', ${at}),
             (2, 'Card', 'liability', 'credit_card', 'TWD', ${at}),
             (3, 'Empty', 'asset', 'cash', 'EUR', ${at})`)
  db.run(sql`INSERT INTO finance_accounts (id, name, type, created_at) VALUES
             (10, 'Food', 'expense', ${at}), (11, 'Opening', 'equity', ${at})`)
  db.run(sql`INSERT INTO finance_transactions (id, occurred_at, source, created_at, updated_at) VALUES
             (1, '2026-01-01T08:00:00Z', 'manual', ${at}, ${at}),
             (2, '2026-01-10T23:30:00Z', 'manual', ${at}, ${at}),
             (3, '2026-01-20T12:00:00Z', 'manual', ${at}, ${at})`)
  db.run(sql`INSERT INTO finance_postings (transaction_id, account_id, amount, currency) VALUES
             (1, 1, 100000, 'EUR'), (1, 11, -100000, 'EUR'),
             (2, 1, -2500, 'EUR'), (2, 10, 2500, 'EUR'),
             (3, 2, -300, 'TWD'), (3, 10, 300, 'TWD')`)
  return db
}

test('餘額 = 分錄加總;負債的欠款是負數;沒有分錄的帳戶是 0', () => {
  assert.deepEqual(getAccountBalances(freshDb()), [
    { accountId: 1, currency: 'EUR', amount: 97500 },
    { accountId: 2, currency: 'TWD', amount: -300 },
    { accountId: 3, currency: 'EUR', amount: 0 },
  ])
})

test('asOf 只算到那一天為止(含當天)', () => {
  const db = freshDb()
  assert.equal(getAccountBalance(db, 1, '2026-01-09').amount, 100000)
  assert.equal(getAccountBalance(db, 1, '2026-01-10').amount, 97500)
  assert.equal(getAccountBalance(db, 2, '2026-01-19').amount, 0)
  assert.equal(getAccountBalance(db, 1, '2025-12-31').amount, 0)
})

test('asOf 早於所有交易時,帳戶仍然都列出來', () => {
  assert.equal(getAccountBalances(freshDb(), '2025-01-01').length, 3)
})

test('分類、權益帳戶、不存在的帳戶沒有餘額', () => {
  const db = freshDb()
  assert.throws(() => getAccountBalance(db, 10), NotBalanceAccountError)
  assert.throws(() => getAccountBalance(db, 11), NotBalanceAccountError)
  assert.throws(() => getAccountBalance(db, 999), NotBalanceAccountError)
})

test('getAccountBalanceForInput:同 getAccountBalance;日期格式不對、不是資產負債帳戶時是 ValidationError', () => {
  const db = freshDb()
  assert.deepEqual(getAccountBalanceForInput(db, 1), getAccountBalance(db, 1))
  assert.throws(() => getAccountBalanceForInput(db, 1, '2026/01/01'), ValidationError)
  assert.throws(() => getAccountBalanceForInput(db, 9999), ValidationError)
})

