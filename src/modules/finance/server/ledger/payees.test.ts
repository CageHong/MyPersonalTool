import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sql } from 'drizzle-orm'
import { NotFoundError, ValidationError } from '../errors'
import { ACCOUNTS, AT, freshLedger } from '../testing'
import {
  deleteAlias,
  deletePayee,
  findPayeeByText,
  listPayeesForAdmin,
  lookupPayee,
  mergePayee,
  moveAlias,
  normalizePayeeText,
  payeeDisplayName,
  renamePayee,
  resolvePayee,
} from './payees'
import { getV2RetiredAt } from './settings'
import { createTransaction } from './transactions'

const suffixes = ['via Processor']

test('正規化:小寫、去頭尾空白、連續空白合成一個', () => {
  assert.equal(normalizePayeeText('  Some   Shop BV ', []), 'some shop bv')
})

test('正規化:去掉結尾的後綴,不分大小寫', () => {
  assert.equal(normalizePayeeText('Some Shop BV via PROCESSOR', suffixes), 'some shop bv')
  assert.equal(normalizePayeeText('Some Shop BV', suffixes), 'some shop bv')
})

test('後綴只在結尾、而且前面有其他文字時才去掉', () => {
  assert.equal(normalizePayeeText('via Processor shop', suffixes), 'via processor shop')
  assert.equal(normalizePayeeText('via Processor', suffixes), 'via processor')
  assert.equal(normalizePayeeText('Shopvia Processor', suffixes), 'shopvia processor')
})

test('顯示名稱保留大小寫,只整理空白與後綴', () => {
  assert.equal(payeeDisplayName(' Some  Shop BV via Processor', suffixes), 'Some Shop BV')
})

test('resolvePayee:第一次看到就新增收款人與別名;寫法只差大小寫、空白、後綴時是同一個', () => {
  const db = freshLedger()
  assert.equal(findPayeeByText(db, 'Some Shop BV', suffixes), null)
  const id = resolvePayee(db, ' Some  Shop BV via Processor', suffixes, AT)
  assert.equal(resolvePayee(db, 'some shop bv', suffixes), id)
  assert.equal(findPayeeByText(db, 'SOME SHOP BV', suffixes), id)
  assert.deepEqual(db.all(sql`SELECT name, created_at FROM finance_payees`), [
    { name: 'Some Shop BV', created_at: AT },
  ])
  assert.deepEqual(db.all(sql`SELECT alias, payee_id FROM finance_payee_aliases`), [
    { alias: 'some shop bv', payee_id: id },
  ])
})

test('resolvePayee:別名表沒有、但已經有同名的收款人時,別名掛到那個收款人', () => {
  const db = freshLedger()
  db.run(sql`INSERT INTO finance_payees (id, name, created_at) VALUES (7, 'Some Shop BV', ${AT})`)
  assert.equal(resolvePayee(db, 'Some Shop BV', suffixes), 7)
  assert.equal(db.all(sql`SELECT * FROM finance_payees`).length, 1)
  assert.equal(findPayeeByText(db, 'some shop bv', suffixes), 7)
})

test('resolvePayee:空白文字回傳 null,不新增', () => {
  const db = freshLedger()
  assert.equal(resolvePayee(db, '   ', suffixes), null)
  assert.equal(db.all(sql`SELECT * FROM finance_payees`).length, 0)
})

test('lookupPayee:只查不寫;別名優先,沒有別名就找同名的收款人', () => {
  const db = freshLedger()
  const shop = resolvePayee(db, 'Some Shop via Processor', suffixes, AT)
  db.run(sql`INSERT INTO finance_payees (id, name, created_at) VALUES (50, 'Corner Cafe', ${AT})`)
  assert.equal(lookupPayee(db, 'SOME SHOP', suffixes), shop)
  assert.equal(lookupPayee(db, 'Corner Cafe', suffixes), 50)
  assert.equal(lookupPayee(db, 'corner cafe', suffixes), null) // 顯示名稱保留大小寫,跟 resolvePayee 一樣
  assert.equal(lookupPayee(db, 'Nobody', suffixes), null)
  assert.equal(db.all(sql`SELECT * FROM finance_payee_aliases`).length, 1)
})

// ── 管理 ────────────────────────────────────────────────────────

function adminLedger() {
  const db = freshLedger()
  db.run(sql`INSERT INTO finance_payees (id, name, created_at) VALUES (1, 'Corner Shop', ${AT}), (2, 'Corner Shop BV', ${AT}), (3, 'Unused', ${AT})`)
  db.run(sql`INSERT INTO finance_payee_aliases VALUES ('corner shop', 1), ('corner shop bv', 2), ('cs bv', 2)`)
  db.run(sql`INSERT INTO finance_rules (match_field, payee_id, assign_account_id, created_at) VALUES ('payee', 2, ${ACCOUNTS.food}, ${AT})`)
  createTransaction(db, {
    occurredAt: '2030-01-15T09:30:00+00:00', source: 'manual', payeeId: 2,
    postings: [{ accountId: ACCOUNTS.wiseEur, amount: -100, currency: 'EUR' }, { accountId: ACCOUNTS.food, amount: 100, currency: 'EUR' }],
  }, AT)
  return db
}

function adminFields(fn: () => unknown): Record<string, string> {
  try {
    fn()
  } catch (error) {
    assert.ok(error instanceof ValidationError, String(error))
    return error.fields
  }
  assert.fail('應該要丟 ValidationError')
}

test('管理清單:交易筆數、別名、規則數', () => {
  const rows = listPayeesForAdmin(adminLedger())
  assert.deepEqual(rows.find((r) => r.id === 2), {
    id: 2, name: 'Corner Shop BV', transactionCount: 1, aliases: ['corner shop bv', 'cs bv'], rules: 1, scheduled: 0,
  })
})

test('改名:不能重複、不能空白', () => {
  const db = adminLedger()
  renamePayee(db, 3, ' Bakery ', '2030-02-01T00:00:00Z')
  assert.equal(listPayeesForAdmin(db).find((r) => r.id === 3)?.name, 'Bakery')
  assert.equal(getV2RetiredAt(db), '2030-02-01T00:00:00+00:00')
  assert.deepEqual(adminFields(() => renamePayee(db, 3, 'Corner Shop')), { name: 'duplicate' })
  assert.deepEqual(adminFields(() => renamePayee(db, 3, ' ')), { name: 'required' })
  assert.throws(() => renamePayee(db, 99, 'X'), NotFoundError)
})

test('合併:交易、別名、規則改指向目標,來源刪掉', () => {
  const db = adminLedger()
  mergePayee(db, 2, 1)
  const one = listPayeesForAdmin(db).find((r) => r.id === 1)
  assert.deepEqual(one?.aliases, ['corner shop', 'corner shop bv', 'cs bv'])
  assert.equal(one?.transactionCount, 1)
  assert.equal(one?.rules, 1)
  assert.equal(listPayeesForAdmin(db).some((r) => r.id === 2), false)
  assert.deepEqual(adminFields(() => mergePayee(db, 1, 1)), { targetId: 'self' })
  assert.deepEqual(adminFields(() => mergePayee(db, 1, 99)), { targetId: 'not_found' })
})

test('別名:移到另一個收款人、刪除;刪除收款人要沒被用到', () => {
  const db = adminLedger()
  moveAlias(db, 'cs bv', 3)
  assert.equal(findPayeeByText(db, 'CS BV', []), 3)
  deleteAlias(db, 'cs bv')
  assert.equal(findPayeeByText(db, 'CS BV', []), null)
  assert.deepEqual(adminFields(() => deleteAlias(db, 'nope')), { alias: 'not_found' })
  assert.deepEqual(adminFields(() => deletePayee(db, 2)), { payee: 'has_transactions' })
  deletePayee(db, 3)
  assert.equal(listPayeesForAdmin(db).some((r) => r.id === 3), false)
})
