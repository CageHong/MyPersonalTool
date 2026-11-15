import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sql } from 'drizzle-orm'
import { ACCOUNTS, AT, freshLedger } from '../testing'
import { getV2RetiredAt } from '../ledger/settings'
import { createTransaction } from '../ledger/transactions'
import { applyReclassify, planReclassify } from './reclassify'

// 三筆未分類:Shop 有對象規則、Cafe 什麼都沒有、一筆入帳的來源分類有規則;另一筆已經分類的不動
function ledger() {
  const db = freshLedger()
  db.run(sql`INSERT INTO finance_accounts (id, name, type, created_at) VALUES (20, 'Salary', 'income', ${AT})`)
  db.run(sql`INSERT INTO finance_payees (id, name, created_at) VALUES (1, 'Shop', ${AT}), (2, 'Cafe', ${AT})`)
  db.run(sql`INSERT INTO finance_rules (match_field, payee_id, assign_account_id, created_at) VALUES ('payee', 1, ${ACCOUNTS.food}, ${AT})`)
  db.run(sql`INSERT INTO finance_rules (match_field, match_value, assign_account_id, created_at) VALUES ('source_category', 'Payroll', 20, ${AT})`)
  const out = (payeeId: number, account: number, day: string) =>
    createTransaction(db, {
      occurredAt: `2030-01-${day}T09:00:00+00:00`, source: 'manual', payeeId,
      postings: [{ accountId: ACCOUNTS.wiseEur, amount: -500, currency: 'EUR' }, { accountId: account, amount: 500, currency: 'EUR' }],
    }, AT)
  const shop = out(1, ACCOUNTS.uncategorized, '10')
  const cafe = out(2, ACCOUNTS.uncategorized, '11')
  const done = out(1, ACCOUNTS.food, '12')
  const salary = createTransaction(db, {
    occurredAt: '2030-01-13T09:00:00+00:00', source: 'wise_csv', externalId: 'IN-1', importMeta: { source_category: 'Payroll' },
    postings: [{ accountId: ACCOUNTS.wiseEur, amount: 9000, currency: 'EUR' }, { accountId: ACCOUNTS.uncategorizedIncome, amount: -9000, currency: 'EUR' }],
  }, AT)
  return { db, shop, cafe, done, salary }
}

test('預覽:列出會被分到哪裡;沒命中的只算筆數;已經分類的不出現', () => {
  const { db, shop, salary } = ledger()
  const preview = planReclassify(db)
  assert.deepEqual(
    preview.items.map((i) => [i.transactionId, i.accountId, i.categorySource, i.amount]),
    [[salary, 20, 'source_category', 9000], [shop, ACCOUNTS.food, 'rule', 500]],
  )
  assert.equal(preview.unmatched, 1)
})

test('套用:只寫選中的;分類來源照決定的來源;沒選的、已經不是未分類的跳過', () => {
  const { db, shop, cafe, salary } = ledger()
  assert.deepEqual(applyReclassify(db, [shop, cafe], '2030-02-01T00:00:00Z'), { applied: 1, skipped: 1 })
  const row = (id: number) =>
    db.all<{ category_source: string | null; account_id: number }>(sql`
      SELECT t.category_source, p.account_id FROM finance_transactions t JOIN finance_postings p ON p.transaction_id = t.id
      WHERE t.id = ${id} AND p.amount > 0`)[0]
  assert.deepEqual(row(shop), { category_source: 'rule', account_id: ACCOUNTS.food })
  assert.equal(getV2RetiredAt(db), '2030-02-01T00:00:00+00:00')
  assert.deepEqual(applyReclassify(db, [shop], AT), { applied: 0, skipped: 1 })
  assert.equal(planReclassify(db).items.map((i) => i.transactionId).includes(salary), true)
})
