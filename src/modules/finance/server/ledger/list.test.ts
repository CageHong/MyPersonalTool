import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sql } from 'drizzle-orm'
import { applyMigrations, openDb } from '../../db/index'
import type { TransactionFilter } from '../../lib/transactions'
import { ValidationError } from '../errors'
import { listTransactions } from './list'

// 虛構的帳本:每種交易類型至少一筆
function freshDb() {
  const db = openDb(':memory:')
  applyMigrations(db)
  const at = '2026-01-01T00:00:00Z'
  db.run(sql`INSERT INTO finance_currencies VALUES ('EUR', 2, 'Euro'), ('USD', 2, 'US Dollar')`)
  db.run(sql`INSERT INTO finance_settings VALUES ('display_currency', 'EUR')`)
  db.run(sql`INSERT INTO finance_fx_rates VALUES ('2026-01-01', 'USD', 0.9, 'test', ${at})`)
  db.run(sql`INSERT INTO finance_accounts (id, name, type, subtype, currency, created_at) VALUES
             (1, 'Bank', 'asset', 'bank', 'EUR', ${at}),
             (2, 'Wallet', 'asset', 'bank', 'USD', ${at}),
             (3, 'Deposit', 'asset', 'deposit', 'EUR', ${at})`)
  db.run(sql`INSERT INTO finance_accounts (id, name, type, is_system, created_at) VALUES
             (20, '未分類', 'expense', 1, ${at}), (21, '未分類收入', 'income', 1, ${at}),
             (22, '手續費', 'expense', 1, ${at}), (23, '換匯', 'equity', 1, ${at}),
             (24, '期初餘額', 'equity', 1, ${at})`)
  db.run(sql`INSERT INTO finance_accounts (id, name, type, parent_id, created_at) VALUES
             (10, 'Food', 'expense', NULL, ${at}), (11, 'Transport', 'expense', NULL, ${at}),
             (12, 'Train', 'expense', 11, ${at}), (13, 'Salary', 'income', NULL, ${at})`)
  db.run(sql`INSERT INTO finance_payees (id, name, created_at) VALUES
             (1, 'Corner Shop', ${at}), (2, 'Rail Co', ${at}), (3, 'Employer', ${at})`)
  db.run(sql`INSERT INTO finance_payee_aliases VALUES ('rail co nv', 2)`)
  db.run(sql`INSERT INTO finance_tags (id, name, created_at) VALUES (1, 'Trip', ${at})`)
  const tx = (id: number, when: string, payee: number | null, note: string | null) =>
    db.run(sql`INSERT INTO finance_transactions (id, occurred_at, payee_id, note, source, created_at, updated_at)
               VALUES (${id}, ${when}, ${payee}, ${note}, 'manual', ${at}, ${at})`)
  tx(1, '2026-01-01T08:00:00Z', null, null)
  tx(2, '2026-01-05T10:00:00Z', 1, 'weekly 100% shop')
  tx(3, '2026-01-06T10:00:00Z', 2, null)
  tx(4, '2026-01-07T10:00:00Z', 3, null)
  tx(5, '2026-01-08T10:00:00Z', null, null)
  tx(6, '2026-01-09T10:00:00Z', null, null)
  tx(7, '2026-01-10T10:00:00Z', null, null)
  tx(8, '2026-01-11T10:00:00Z', null, null)
  tx(9, '2026-01-12T10:00:00Z', 1, null)
  tx(10, '2026-01-12T10:00:00Z', null, null)
  db.run(sql`INSERT INTO finance_postings (transaction_id, account_id, amount, currency, memo, sort_order) VALUES
             (1, 1, 100000, 'EUR', NULL, 0), (1, 24, -100000, 'EUR', NULL, 1),
             (2, 1, -3000, 'EUR', NULL, 0), (2, 10, 2500, 'EUR', NULL, 1), (2, 11, 500, 'EUR', 'bags', 2),
             (3, 1, -1200, 'EUR', NULL, 0), (3, 12, 1200, 'EUR', NULL, 1),
             (4, 1, 50000, 'EUR', NULL, 0), (4, 13, -50000, 'EUR', NULL, 1),
             (5, 1, -10000, 'EUR', NULL, 0), (5, 3, 10000, 'EUR', NULL, 1),
             (6, 1, -11000, 'EUR', NULL, 0), (6, 23, 11000, 'EUR', NULL, 1),
             (6, 2, 12000, 'USD', NULL, 2), (6, 23, -12000, 'USD', NULL, 3),
             (6, 1, -100, 'EUR', NULL, 4), (6, 22, 100, 'EUR', NULL, 5),
             (7, 1, -200, 'EUR', NULL, 0), (7, 22, 200, 'EUR', NULL, 1),
             (8, 2, -500, 'USD', NULL, 0), (8, 20, 500, 'USD', NULL, 1),
             (9, 1, 300, 'EUR', NULL, 0), (9, 10, -300, 'EUR', NULL, 1),
             (10, 1, -100, 'EUR', NULL, 0), (10, 10, 100, 'EUR', NULL, 1)`)
  db.run(sql`INSERT INTO finance_transaction_tags VALUES (3, 1)`)
  return db
}

const ids = (db: ReturnType<typeof freshDb>, filter: Partial<TransactionFilter> = {}) =>
  listTransactions(db, { order: 'desc', ...filter }).items.map((row) => row.id)

test('類型由分錄推導;手續費不決定類型,只有手續費時算支出', () => {
  const kinds = Object.fromEntries(listTransactions(freshDb(), { order: 'desc' }).items.map((r) => [r.id, r.kind]))
  assert.deepEqual(kinds, {
    1: 'opening', 2: 'expense', 3: 'expense', 4: 'income', 5: 'transfer',
    6: 'exchange', 7: 'expense', 8: 'expense', 9: 'expense', 10: 'expense',
  })
})

test('預設由新到舊,同一時間依 id;asc 反過來', () => {
  const db = freshDb()
  assert.deepEqual(ids(db), [10, 9, 8, 7, 6, 5, 4, 3, 2, 1])
  assert.deepEqual(ids(db, { order: 'asc' }), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
})

test('keyset 分頁:逐頁取完等於一次取完,不重複不遺漏', () => {
  const db = freshDb()
  for (const order of ['desc', 'asc'] as const) {
    const seen: number[] = []
    let cursor: string | undefined
    for (;;) {
      const page = listTransactions(db, { order }, { cursor, limit: 3 })
      seen.push(...page.items.map((r) => r.id))
      if (!page.nextCursor) break
      cursor = page.nextCursor
    }
    assert.deepEqual(seen, ids(db, { order }))
  }
})

test('兩頁之間帳本多了一筆最新的交易,第二頁不會重複第一頁的列', () => {
  const db = freshDb()
  const first = listTransactions(db, { order: 'desc' }, { limit: 3 })
  db.run(sql`INSERT INTO finance_transactions (id, occurred_at, source, created_at, updated_at)
             VALUES (11, '2026-02-01T00:00:00Z', 'manual', '2026-02-01T00:00:00Z', '2026-02-01T00:00:00Z')`)
  db.run(sql`INSERT INTO finance_postings (transaction_id, account_id, amount, currency) VALUES (11, 1, -100, 'EUR'), (11, 10, 100, 'EUR')`)
  const second = listTransactions(db, { order: 'desc' }, { cursor: first.nextCursor ?? undefined, limit: 3 })
  assert.deepEqual(first.items.map((r) => r.id), [10, 9, 8])
  assert.deepEqual(second.items.map((r) => r.id), [7, 6, 5])
})

test('最後一頁沒有 nextCursor;不合法的 cursor 與 limit 是 ValidationError', () => {
  const db = freshDb()
  assert.equal(listTransactions(db, { order: 'desc' }, { limit: 10 }).nextCursor, null)
  assert.throws(() => listTransactions(db, { order: 'desc' }, { cursor: 'nope' }), ValidationError)
  assert.throws(() => listTransactions(db, { order: 'desc' }, { cursor: Buffer.from('[1,2]').toString('base64url') }), ValidationError)
  assert.throws(() => listTransactions(db, { order: 'desc' }, { limit: 0 }), ValidationError)
  assert.throws(() => listTransactions(db, { order: 'desc' }, { limit: 201 }), ValidationError)
})

test('日期範圍含頭尾兩天', () => {
  assert.deepEqual(ids(freshDb(), { from: '2026-01-06', to: '2026-01-08' }), [5, 4, 3])
})

test('帳戶:有任何分錄在該帳戶', () => {
  const db = freshDb()
  assert.deepEqual(ids(db, { accountId: 3 }), [5])
  assert.deepEqual(ids(db, { accountId: 2 }), [8, 6])
})

test('分類:選上層包含子分類,選子分類只有它自己', () => {
  const db = freshDb()
  assert.deepEqual(ids(db, { categoryId: 11 }), [3, 2])
  assert.deepEqual(ids(db, { categoryId: 12 }), [3])
})

test('標籤、收款人、類型、未分類', () => {
  const db = freshDb()
  assert.deepEqual(ids(db, { tagId: 1 }), [3])
  assert.deepEqual(ids(db, { payeeId: 1 }), [9, 2])
  assert.deepEqual(ids(db, { kind: 'transfer' }), [5])
  assert.deepEqual(ids(db, { kind: 'expense', accountId: 2 }), [8])
  assert.deepEqual(ids(db, { uncategorized: true }), [8])
})

test('搜尋:收款人名稱、別名、備註、分錄備註;不分大小寫;% 是一般字元', () => {
  const db = freshDb()
  assert.deepEqual(ids(db, { q: 'corner' }), [9, 2])
  assert.deepEqual(ids(db, { q: 'CO NV' }), [3])
  assert.deepEqual(ids(db, { q: 'weekly' }), [2])
  assert.deepEqual(ids(db, { q: 'BAGS' }), [2])
  assert.deepEqual(ids(db, { q: '100%' }), [2])
  assert.deepEqual(ids(db, { q: '%' }), [2])
  assert.deepEqual(ids(db, { q: 'nothing here' }), [])
})

test('每一列:分類(子分類帶上層)、帳戶側同帳戶合併、標籤、分錄', () => {
  const rows = new Map(listTransactions(freshDb(), { order: 'desc' }).items.map((r) => [r.id, r]))
  assert.deepEqual(rows.get(2)?.categories, [
    { id: 10, name: 'Food', parentName: null },
    { id: 11, name: 'Transport', parentName: null },
  ])
  assert.deepEqual(rows.get(3)?.categories, [{ id: 12, name: 'Train', parentName: 'Transport' }])
  assert.deepEqual(rows.get(3)?.tags, [{ id: 1, name: 'Trip' }])
  assert.deepEqual(rows.get(2)?.payee, { id: 1, name: 'Corner Shop' })
  assert.equal(rows.get(2)?.postings.length, 3)
  assert.equal(rows.get(2)?.postings[2]?.memo, 'bags')
  assert.deepEqual(rows.get(6)?.legs, [
    { accountId: 1, accountName: 'Bank', currency: 'EUR', amount: -11100 },
    { accountId: 2, accountName: 'Wallet', currency: 'USD', amount: 12000 },
  ])
  assert.deepEqual(rows.get(5)?.legs.map((l) => l.amount), [-10000, 10000])
})

test('折合金額:分類側取負號換成顯示幣別;轉帳、換匯、期初餘額沒有', () => {
  const rows = new Map(listTransactions(freshDb(), { order: 'desc' }).items.map((r) => [r.id, r.displayAmount]))
  assert.equal(rows.get(2), -3000)
  assert.equal(rows.get(4), 50000)
  assert.equal(rows.get(7), -200)
  assert.equal(rows.get(8), -450)
  assert.equal(rows.get(9), 300)
  assert.equal(rows.get(1), null)
  assert.equal(rows.get(5), null)
  assert.equal(rows.get(6), null)
})

test('缺匯率時折合金額是 null,其他欄位照常', () => {
  const db = freshDb()
  db.run(sql`DELETE FROM finance_fx_rates`)
  const row = listTransactions(db, { order: 'desc' }).items.find((r) => r.id === 8)
  assert.equal(row?.displayAmount, null)
  assert.equal(row?.legs[0]?.amount, -500)
})
