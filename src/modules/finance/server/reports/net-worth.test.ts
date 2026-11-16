import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sql } from 'drizzle-orm'
import { applyMigrations, openDb } from '../../db/index'
import { getNetWorth } from './net-worth'

// 虛構的帳本:兩個群組 + 未分組;EUR、USD(有匯率)、JPY(沒有匯率);信用卡負債;封存帳戶
function freshDb() {
  const db = openDb(':memory:')
  applyMigrations(db)
  const at = '2026-01-01T00:00:00Z'
  db.run(sql`INSERT INTO finance_currencies VALUES ('EUR', 2, 'Euro'), ('USD', 2, 'US Dollar'), ('JPY', 0, 'Yen')`)
  db.run(sql`INSERT INTO finance_settings VALUES ('display_currency', 'EUR')`)
  db.run(sql`INSERT INTO finance_fx_rates VALUES ('2026-01-01', 'USD', 0.5, 'test', ${at}), ('2026-02-01', 'USD', 0.8, 'test', ${at})`)
  db.run(sql`INSERT INTO finance_account_groups (id, name, currency, sort_order, created_at) VALUES
             (1, 'Daily', NULL, 1, ${at}), (2, 'Abroad', 'USD', 0, ${at})`)
  db.run(sql`INSERT INTO finance_accounts (id, name, type, subtype, currency, group_id, sort_order, is_active, created_at) VALUES
             (1, 'Bank', 'asset', 'bank', 'EUR', 1, 0, 1, ${at}),
             (2, 'Card', 'liability', 'credit_card', 'EUR', 1, 1, 1, ${at}),
             (3, 'Dollar cash', 'asset', 'cash', 'USD', 2, 0, 1, ${at}),
             (4, 'Broker', 'asset', 'broker', 'EUR', NULL, 0, 1, ${at}),
             (5, 'Old', 'asset', 'bank', 'EUR', 1, 2, 0, ${at}),
             (6, 'Yen', 'asset', 'cash', 'JPY', NULL, 1, 1, ${at}),
             (7, 'Empty yen', 'asset', 'cash', 'JPY', 2, 1, 1, ${at})`)
  db.run(sql`INSERT INTO finance_accounts (id, name, type, is_system, created_at) VALUES (24, '期初餘額', 'equity', 1, ${at})`)
  db.run(sql`INSERT INTO finance_transactions (id, occurred_at, source, created_at, updated_at)
             VALUES (1, '2026-01-01T00:00:00Z', 'manual', ${at}, ${at})`)
  db.run(sql`INSERT INTO finance_postings (transaction_id, account_id, amount, currency, sort_order) VALUES
             (1, 1, 100000, 'EUR', 0), (1, 2, -20000, 'EUR', 1), (1, 3, 10000, 'USD', 2),
             (1, 4, 30000, 'EUR', 3), (1, 6, 500, 'JPY', 4),
             (1, 24, -110000, 'EUR', 5), (1, 24, -10000, 'USD', 6), (1, 24, -500, 'JPY', 7)`)
  return db
}

test('淨資產用 asOf 當天或之前最近的匯率;負債扣掉;缺匯率的帳戶不算並計數', () => {
  const n = getNetWorth(freshDb(), '2026-03-01')
  // 1000 − 200 + 100 USD × 0.8 + 300 = 1180 EUR;JPY 沒有匯率
  assert.equal(n.netWorth, 118000)
  assert.equal(n.missingRate, 1)
  assert.equal(n.currency, 'EUR')
  assert.equal(getNetWorth(freshDb(), '2026-01-15').netWorth, 115000)
})

test('可動用資金:只算 cash、bank 子類型', () => {
  // Bank 1000 + Dollar cash 80;信用卡、券商不算;JPY 缺匯率
  assert.equal(getNetWorth(freshDb(), '2026-03-01').available, 108000)
})

test('群組:依群組順序,未分組放最後;合計用群組的幣別;封存且餘額為 0 的帳戶不列', () => {
  const { groups } = getNetWorth(freshDb(), '2026-03-01')
  assert.deepEqual(
    groups.map((g) => [g.id, g.name, g.currency, g.total, g.accounts.map((a) => a.name)]),
    [
      [2, 'Abroad', 'USD', 10000, ['Dollar cash', 'Empty yen']],
      [1, 'Daily', 'EUR', 80000, ['Bank', 'Card']],
      [null, '未分組', 'EUR', null, ['Broker', 'Yen']],
    ],
  )
  assert.deepEqual(groups[1].accounts[1], { id: 2, name: 'Card', type: 'liability', currency: 'EUR', balance: -20000, isActive: true })
})
