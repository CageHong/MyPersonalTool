import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sql } from 'drizzle-orm'
import type { FinanceDb } from '../../db/index'
import { NotFoundError, ValidationError } from '../errors'
import { ACCOUNTS, AT, freshLedger } from '../testing'
import { createTransaction, setTransactionPayee, unbalancedCurrencies } from './transactions'
import type { NewTransaction } from './transactions'

const count = (db: FinanceDb, table: string) =>
  db.all<{ n: number }>(sql.raw(`SELECT COUNT(*) AS n FROM ${table}`))[0].n

function expense(overrides: Partial<NewTransaction> = {}): NewTransaction {
  return {
    occurredAt: '2030-01-15T09:30:00+00:00',
    source: 'manual',
    postings: [
      { accountId: ACCOUNTS.wiseEur, amount: -1230, currency: 'EUR' },
      { accountId: ACCOUNTS.food, amount: 1230, currency: 'EUR' },
    ],
    ...overrides,
  }
}

function fieldsOf(fn: () => unknown): Record<string, string> {
  try {
    fn()
  } catch (error) {
    assert.ok(error instanceof ValidationError, String(error))
    return error.fields
  }
  assert.fail('應該要丟 ValidationError')
}

test('unbalancedCurrencies:每個幣別各自加總', () => {
  assert.deepEqual(unbalancedCurrencies(expense().postings), [])
  assert.deepEqual(
    unbalancedCurrencies([
      { accountId: 1, amount: -100, currency: 'EUR' },
      { accountId: 2, amount: 100, currency: 'USD' },
    ]),
    ['EUR', 'USD'],
  )
})

test('新增交易:表頭與分錄都寫入,分錄照順序', () => {
  const db = freshLedger()
  const id = createTransaction(
    db,
    expense({ note: 'lunch', externalId: 'X-1', importMeta: { row: { a: '1' } } }),
    AT,
  )
  const [header] = db.all<Record<string, unknown>>(
    sql`SELECT occurred_at, note, source, external_id, import_meta, category_source, created_at, updated_at
        FROM finance_transactions WHERE id = ${id}`,
  )
  assert.deepEqual(header, {
    occurred_at: '2030-01-15T09:30:00+00:00',
    note: 'lunch',
    source: 'manual',
    external_id: 'X-1',
    import_meta: '{"row":{"a":"1"}}',
    category_source: null,
    created_at: AT,
    updated_at: AT,
  })
  assert.deepEqual(
    db.all(sql`SELECT account_id, amount, currency, sort_order FROM finance_postings
               WHERE transaction_id = ${id} ORDER BY sort_order`),
    [
      { account_id: ACCOUNTS.wiseEur, amount: -1230, currency: 'EUR', sort_order: 0 },
      { account_id: ACCOUNTS.food, amount: 1230, currency: 'EUR', sort_order: 1 },
    ],
  )
})

test('多幣別:每個幣別各自平衡才能寫入', () => {
  const db = freshLedger()
  const id = createTransaction(db, {
    occurredAt: '2030-01-15T09:30:00Z',
    source: 'manual',
    postings: [
      { accountId: ACCOUNTS.wiseUsd, amount: -20000, currency: 'USD' },
      { accountId: ACCOUNTS.exchange, amount: 20000, currency: 'USD' },
      { accountId: ACCOUNTS.exchange, amount: -18320, currency: 'EUR' },
      { accountId: ACCOUNTS.wiseEur, amount: 18320, currency: 'EUR' },
    ],
  })
  assert.equal(count(db, 'finance_postings'), 4)
  assert.ok(id > 0)
})

test('借貸不平、分錄太少、金額不合法:丟 ValidationError,資料庫不變', () => {
  const db = freshLedger()
  const unbalanced = expense()
  unbalanced.postings[1].amount = 1200
  assert.deepEqual(fieldsOf(() => createTransaction(db, unbalanced)), { postings: 'unbalanced:EUR' })
  assert.equal(
    fieldsOf(() => createTransaction(db, expense({ postings: [] }))).postings,
    'too_few',
  )
  const fractional = expense()
  fractional.postings[0].amount = -12.5
  fractional.postings[1].amount = 12.5
  assert.equal(fieldsOf(() => createTransaction(db, fractional))['postings.0.amount'], 'invalid')
  assert.equal(count(db, 'finance_transactions'), 0)
  assert.equal(count(db, 'finance_postings'), 0)
})

test('帳戶不存在、分錄幣別與帳戶幣別不同', () => {
  const db = freshLedger()
  const missing = expense()
  missing.postings[1].accountId = 999
  assert.equal(fieldsOf(() => createTransaction(db, missing))['postings.1.accountId'], 'not_found')
  const wrongCurrency = expense({
    postings: [
      { accountId: ACCOUNTS.wiseEur, amount: -1230, currency: 'USD' },
      { accountId: ACCOUNTS.food, amount: 1230, currency: 'USD' },
    ],
  })
  assert.deepEqual(fieldsOf(() => createTransaction(db, wrongCurrency)), {
    'postings.0.currency': 'account_currency_mismatch',
  })
})

test('時間格式不對、收款人不存在、來源 ID 重複', () => {
  const db = freshLedger()
  assert.equal(
    fieldsOf(() => createTransaction(db, expense({ occurredAt: '2030-01-15 09:30:00' }))).occurredAt,
    'invalid',
  )
  assert.equal(
    fieldsOf(() => createTransaction(db, expense({ occurredAt: '2030-01-15T09:30:00+01:00' })))
      .occurredAt,
    'invalid',
  )
  assert.equal(fieldsOf(() => createTransaction(db, expense({ payeeId: 5 }))).payeeId, 'not_found')
  createTransaction(db, expense({ externalId: 'X-1' }))
  assert.equal(
    fieldsOf(() => createTransaction(db, expense({ externalId: 'X-1' }))).externalId,
    'duplicate',
  )
  assert.equal(count(db, 'finance_transactions'), 1)
})

test('包在外層的 DB transaction 裡:外層失敗時一起復原', () => {
  const db = freshLedger()
  assert.throws(() =>
    db.transaction((tx) => {
      createTransaction(tx, expense())
      throw new Error('outer')
    }),
  )
  assert.equal(count(db, 'finance_transactions'), 0)
})

test('setTransactionPayee:只改對象與 updated_at', () => {
  const db = freshLedger()
  db.run(sql`INSERT INTO finance_payees (id, name, created_at) VALUES (1, 'Some Shop BV', ${AT})`)
  const id = createTransaction(db, expense(), AT)
  setTransactionPayee(db, id, 1, '2030-02-01T00:00:00Z')
  assert.deepEqual(
    db.all(sql`SELECT payee_id, created_at, updated_at FROM finance_transactions WHERE id = ${id}`),
    [{ payee_id: 1, created_at: AT, updated_at: '2030-02-01T00:00:00Z' }],
  )
  assert.equal(count(db, 'finance_postings'), 2)
  setTransactionPayee(db, id, null)
  assert.equal(
    db.all<{ payee_id: number | null }>(sql`SELECT payee_id FROM finance_transactions`)[0].payee_id,
    null,
  )
})

test('setTransactionPayee:交易或收款人不存在', () => {
  const db = freshLedger()
  const id = createTransaction(db, expense())
  assert.throws(() => setTransactionPayee(db, 999, null), NotFoundError)
  assert.equal(fieldsOf(() => setTransactionPayee(db, id, 42)).payeeId, 'not_found')
})
