import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sql } from 'drizzle-orm'
import { applyMigrations, openDb } from '../../db/index'
import { getDisplayCurrency, listPayees } from './lookups'

test('收款人帶交易筆數(沒有交易的是 0),依名稱排序', () => {
  const db = openDb(':memory:')
  applyMigrations(db)
  const at = '2026-01-01T00:00:00Z'
  db.run(sql`INSERT INTO finance_payees (id, name, created_at) VALUES (1, 'Zed Shop', ${at}), (2, 'Alpha Cafe', ${at}), (3, 'Mid Market', ${at})`)
  db.run(sql`INSERT INTO finance_transactions (id, occurred_at, payee_id, source, created_at, updated_at) VALUES
             (1, ${at}, 1, 'manual', ${at}, ${at}), (2, ${at}, 1, 'manual', ${at}, ${at}), (3, ${at}, 3, 'manual', ${at}, ${at})`)
  assert.deepEqual(listPayees(db), [
    { id: 2, name: 'Alpha Cafe', transactionCount: 0 },
    { id: 3, name: 'Mid Market', transactionCount: 1 },
    { id: 1, name: 'Zed Shop', transactionCount: 2 },
  ])
})

test('顯示幣別:讀設定;沒有設定時是 EUR', () => {
  const db = openDb(':memory:')
  applyMigrations(db)
  assert.equal(getDisplayCurrency(db), 'EUR')
  db.run(sql`INSERT INTO finance_settings VALUES ('display_currency', 'TWD')`)
  assert.equal(getDisplayCurrency(db), 'TWD')
})
