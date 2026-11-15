import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sql } from 'drizzle-orm'
import type { FinanceDb } from '../../db/index'
import { NotFoundError, ValidationError } from '../errors'
import { ACCOUNTS, AT, freshLedger } from '../testing'
import { getV2RetiredAt } from './settings'
import {
  createTransaction,
  deleteTransaction,
  setTransactionPayee,
  unbalancedCurrencies,
  updateTransaction,
} from './transactions'
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
  for (const occurredAt of ['2030-02-30T09:30:00+00:00', '2031-02-29T09:30:00Z', '2030-01-15T24:30:00Z']) {
    assert.equal(fieldsOf(() => createTransaction(db, expense({ occurredAt }))).occurredAt, 'invalid')
  }
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

test('週期項目:寫入 scheduledId;項目不存在時是驗證錯誤', () => {
  const db = freshLedger()
  db.run(sql`INSERT INTO finance_payees (id, name, created_at) VALUES (1, 'Landlord', ${AT})`)
  db.run(sql`INSERT INTO finance_scheduled_transactions
             (id, name, account_id, payee_id, amount_min, amount_max, currency, frequency, created_at)
             VALUES (3, 'Rent', ${ACCOUNTS.food}, 1, 0, 100000, 'EUR', 'monthly', ${AT})`)
  const id = createTransaction(db, expense({ scheduledId: 3, categorySource: 'scheduled' }), AT)
  assert.deepEqual(
    db.all(sql`SELECT scheduled_id, category_source FROM finance_transactions WHERE id = ${id}`),
    [{ scheduled_id: 3, category_source: 'scheduled' }],
  )
  assert.deepEqual(fieldsOf(() => createTransaction(db, expense({ scheduledId: 99 }), AT)), {
    scheduledId: 'not_found',
  })
})

// ── 單筆編輯 ────────────────────────────────────────────────────

const EDIT_AT = '2030-02-01T12:00:00.123Z'
const EDIT_STAMP = '2030-02-01T12:00:00+00:00'
const EDIT_VERSION = '2030-02-01T12:00:00.123+00:00'

// 帳本 + 幾個分類、收款人、標籤,和一筆分類是 Food 的支出
function editLedger() {
  const db = freshLedger()
  db.run(sql`INSERT INTO finance_accounts (id, name, type, is_active, created_at) VALUES
             (20, 'Transport', 'expense', 1, ${AT}), (21, 'Salary', 'income', 1, ${AT}),
             (22, 'Old Hobby', 'expense', 0, ${AT})`)
  db.run(sql`INSERT INTO finance_payees (id, name, created_at) VALUES (1, 'Corner Shop', ${AT})`)
  db.run(sql`INSERT INTO finance_tags (id, name, created_at) VALUES (1, 'Trip', ${AT}), (2, 'Gift', ${AT})`)
  const id = createTransaction(db, expense({ categorySource: 'rule' }), AT)
  db.run(sql`INSERT INTO finance_transaction_tags VALUES (${id}, 1)`)
  const [food] = db.all<{ id: number }>(sql`SELECT id FROM finance_postings WHERE transaction_id = ${id} AND account_id = ${ACCOUNTS.food}`)
  return { db, id, foodPosting: food.id }
}

const headerOf = (db: FinanceDb, id: number) =>
  db.all<Record<string, unknown>>(
    sql`SELECT occurred_at, payee_id, note, category_source, updated_at FROM finance_transactions WHERE id = ${id}`,
  )[0]
const tagsOf = (db: FinanceDb, id: number) =>
  db.all<{ name: string }>(sql`SELECT g.name FROM finance_transaction_tags tt JOIN finance_tags g ON g.id = tt.tag_id
                               WHERE tt.transaction_id = ${id} ORDER BY g.name`).map((r) => r.name)

test('編輯:只改 patch 裡有的欄位;時間存成 +00:00 到秒;第一次編輯寫入 v2 停用', () => {
  const { db, id } = editLedger()
  assert.equal(getV2RetiredAt(db), null)
  updateTransaction(db, id, { expectedUpdatedAt: AT, note: '  dinner  ', occurredAt: '2030-01-20T18:45:30.500Z' }, EDIT_AT)
  assert.deepEqual(headerOf(db, id), {
    occurred_at: '2030-01-20T18:45:30+00:00', payee_id: null, note: 'dinner', category_source: 'rule', updated_at: EDIT_VERSION,
  })
  assert.deepEqual(tagsOf(db, id), ['Trip'])
  assert.equal(getV2RetiredAt(db), EDIT_STAMP)
  // 第二次編輯不改停用的時間;備註清空
  updateTransaction(db, id, { expectedUpdatedAt: EDIT_VERSION, note: '' }, '2030-03-01T00:00:00Z')
  assert.equal(headerOf(db, id).note, null)
  assert.equal(getV2RetiredAt(db), EDIT_STAMP)
})

test('編輯:資料是舊的(updatedAt 不同)時拒絕,資料庫不變;交易不存在是 NotFoundError', () => {
  const { db, id } = editLedger()
  assert.deepEqual(fieldsOf(() => updateTransaction(db, id, { expectedUpdatedAt: '2029-01-01T00:00:00+00:00', note: 'x' })), {
    expectedUpdatedAt: 'stale',
  })
  assert.equal(headerOf(db, id).note, null)
  assert.equal(getV2RetiredAt(db), null)
  assert.throws(() => updateTransaction(db, 999, { expectedUpdatedAt: AT }), NotFoundError)
})

test('編輯分類:換到同類型的分類,記為 manual;回到未分類時分類來源是 null', () => {
  const { db, id, foodPosting } = editLedger()
  updateTransaction(db, id, { expectedUpdatedAt: AT, categories: [{ postingId: foodPosting, accountId: 20 }] }, EDIT_AT)
  const accounts = db.all<{ account_id: number; amount: number }>(
    sql`SELECT account_id, amount FROM finance_postings WHERE transaction_id = ${id} ORDER BY sort_order`,
  )
  assert.deepEqual(accounts, [{ account_id: ACCOUNTS.wiseEur, amount: -1230 }, { account_id: 20, amount: 1230 }])
  assert.equal(headerOf(db, id).category_source, 'manual')
  updateTransaction(db, id, { expectedUpdatedAt: EDIT_VERSION, categories: [{ postingId: foodPosting, accountId: ACCOUNTS.uncategorized }] }, '2030-03-01T00:00:00Z')
  assert.equal(headerOf(db, id).category_source, null)
})

test('編輯分類:沒有換(同一個分類)時分類來源不變', () => {
  const { db, id, foodPosting } = editLedger()
  updateTransaction(db, id, { expectedUpdatedAt: AT, categories: [{ postingId: foodPosting, accountId: ACCOUNTS.food }] }, EDIT_AT)
  assert.equal(headerOf(db, id).category_source, 'rule')
})

test('編輯分類:類型不同、帳戶側的分錄、手續費、封存、不存在、別筆交易的分錄都拒絕', () => {
  const { db, id, foodPosting } = editLedger()
  const other = createTransaction(db, expense({ occurredAt: '2030-01-16T09:30:00+00:00' }), AT)
  const [otherPosting] = db.all<{ id: number }>(sql`SELECT id FROM finance_postings WHERE transaction_id = ${other} LIMIT 1`)
  const [bankPosting] = db.all<{ id: number }>(sql`SELECT id FROM finance_postings WHERE transaction_id = ${id} AND account_id = ${ACCOUNTS.wiseEur}`)
  const tryChange = (postingId: number, accountId: number) =>
    fieldsOf(() => updateTransaction(db, id, { expectedUpdatedAt: AT, categories: [{ postingId, accountId }] }))
  assert.deepEqual(tryChange(foodPosting, 21), { 'categories.0': 'type_mismatch' })
  assert.deepEqual(tryChange(foodPosting, ACCOUNTS.fee), { 'categories.0': 'fee' })
  assert.deepEqual(tryChange(foodPosting, 22), { 'categories.0': 'archived' })
  assert.deepEqual(tryChange(foodPosting, 999), { 'categories.0': 'account_not_found' })
  assert.deepEqual(tryChange(bankPosting.id, 20), { 'categories.0': 'not_a_category' })
  assert.deepEqual(tryChange(otherPosting.id, 20), { 'categories.0': 'posting_not_found' })
  assert.deepEqual(
    fieldsOf(() => updateTransaction(db, id, { expectedUpdatedAt: AT, categories: [{ postingId: foodPosting, accountId: 20 }, { postingId: foodPosting, accountId: 20 }] })),
    { 'categories.1': 'duplicate' },
  )
  const fee = createTransaction(db, { ...expense(), postings: [
    { accountId: ACCOUNTS.wiseEur, amount: -100, currency: 'EUR' }, { accountId: ACCOUNTS.fee, amount: 100, currency: 'EUR' }] }, AT)
  const [feePosting] = db.all<{ id: number }>(sql`SELECT id FROM finance_postings WHERE transaction_id = ${fee} AND account_id = ${ACCOUNTS.fee}`)
  assert.deepEqual(fieldsOf(() => updateTransaction(db, fee, { expectedUpdatedAt: AT, categories: [{ postingId: feePosting.id, accountId: 20 }] })), { 'categories.0': 'fee' })
})

test('編輯對象:選既有的、輸入名稱(比對別名,對不到才新增)、清空', () => {
  const { db, id } = editLedger()
  db.run(sql`INSERT INTO finance_payee_aliases VALUES ('corner shop nv', 1)`)
  updateTransaction(db, id, { expectedUpdatedAt: AT, payee: { id: 1 } }, EDIT_AT)
  assert.equal(headerOf(db, id).payee_id, 1)
  updateTransaction(db, id, { expectedUpdatedAt: EDIT_VERSION, payee: { name: 'CORNER SHOP NV' } }, '2030-02-02T00:00:00Z')
  assert.equal(headerOf(db, id).payee_id, 1)
  updateTransaction(db, id, { expectedUpdatedAt: '2030-02-02T00:00:00.000+00:00', payee: { name: ' New  Bakery ' } }, '2030-02-03T00:00:00Z')
  const [bakery] = db.all<{ id: number; name: string }>(sql`SELECT id, name FROM finance_payees WHERE name = 'New Bakery'`)
  assert.equal(headerOf(db, id).payee_id, bakery.id)
  updateTransaction(db, id, { expectedUpdatedAt: '2030-02-03T00:00:00.000+00:00', payee: null }, '2030-02-04T00:00:00Z')
  assert.equal(headerOf(db, id).payee_id, null)
  assert.deepEqual(fieldsOf(() => updateTransaction(db, id, { expectedUpdatedAt: '2030-02-04T00:00:00.000+00:00', payee: { id: 999 } })), { payee: 'not_found' })
  assert.deepEqual(fieldsOf(() => updateTransaction(db, id, { expectedUpdatedAt: '2030-02-04T00:00:00.000+00:00', payee: { name: '  ' } })), { payee: 'required' })
})

test('編輯標籤:給完整的集合;新名稱建立標籤,同名的已存在就用它', () => {
  const { db, id } = editLedger()
  updateTransaction(db, id, { expectedUpdatedAt: AT, tags: { ids: [2], newNames: [' Trip ', 'Picnic', 'Picnic'] } }, EDIT_AT)
  assert.deepEqual(tagsOf(db, id), ['Gift', 'Picnic', 'Trip'])
  assert.equal(count(db, 'finance_tags'), 3)
  updateTransaction(db, id, { expectedUpdatedAt: EDIT_VERSION, tags: { ids: [], newNames: [] } }, '2030-03-01T00:00:00Z')
  assert.deepEqual(tagsOf(db, id), [])
  assert.deepEqual(fieldsOf(() => updateTransaction(db, id, { expectedUpdatedAt: '2030-03-01T00:00:00.000+00:00', tags: { ids: [99], newNames: [] } })), { tags: 'not_found' })
})

test('編輯:任何一項不合法時整筆不寫入(含新建的對象與標籤)', () => {
  const { db, id } = editLedger()
  const before = { payees: count(db, 'finance_payees'), tags: count(db, 'finance_tags') }
  assert.deepEqual(
    fieldsOf(() => updateTransaction(db, id, { expectedUpdatedAt: AT, payee: { name: 'Brand New' }, tags: { ids: [], newNames: ['Fresh'] }, occurredAt: '2030-02-30T00:00:00Z' })),
    { occurredAt: 'invalid' },
  )
  assert.deepEqual({ payees: count(db, 'finance_payees'), tags: count(db, 'finance_tags') }, before)
  assert.deepEqual(headerOf(db, id).updated_at, AT)
  assert.equal(getV2RetiredAt(db), null)
})

// ── 整組替換分錄、刪除 ──────────────────────────────────────────

const postingsOf = (db: FinanceDb, id: number) =>
  db.all<{ account_id: number; amount: number; memo: string | null }>(
    sql`SELECT account_id, amount, memo FROM finance_postings WHERE transaction_id = ${id} ORDER BY sort_order`,
  )

test('整組替換分錄:拆帳,分類來源改成 manual;內容不變時不動', () => {
  const { db, id } = editLedger()
  updateTransaction(db, id, { expectedUpdatedAt: AT, postings: [
    { accountId: ACCOUNTS.wiseEur, amount: -1230, currency: 'EUR', memo: null },
    { accountId: ACCOUNTS.food, amount: 1000, currency: 'EUR', memo: ' groceries ' },
    { accountId: 20, amount: 230, currency: 'EUR', memo: '' },
  ] }, EDIT_AT)
  assert.deepEqual(postingsOf(db, id), [
    { account_id: ACCOUNTS.wiseEur, amount: -1230, memo: null },
    { account_id: ACCOUNTS.food, amount: 1000, memo: 'groceries' },
    { account_id: 20, amount: 230, memo: null },
  ])
  assert.equal(headerOf(db, id).category_source, 'manual')

  // 同樣的分錄再送一次:分類來源不變(先手動改回別的值來確認)
  db.run(sql`UPDATE finance_transactions SET category_source = 'rule' WHERE id = ${id}`)
  updateTransaction(db, id, { expectedUpdatedAt: EDIT_VERSION, postings: [
    { accountId: ACCOUNTS.wiseEur, amount: -1230, currency: 'EUR', memo: null },
    { accountId: ACCOUNTS.food, amount: 1000, currency: 'EUR', memo: 'groceries' },
    { accountId: 20, amount: 230, currency: 'EUR', memo: null },
  ] }, '2030-03-01T00:00:00Z')
  assert.equal(headerOf(db, id).category_source, 'rule')
})

test('整組替換分錄:改成轉帳(分類換成資產帳戶)後分類來源是 null', () => {
  const { db, id } = editLedger()
  db.run(sql`INSERT INTO finance_accounts (id, name, type, subtype, currency, created_at) VALUES (30, 'Deposit', 'asset', 'deposit', 'EUR', ${AT})`)
  updateTransaction(db, id, { expectedUpdatedAt: AT, postings: [
    { accountId: ACCOUNTS.wiseEur, amount: -1230, currency: 'EUR', memo: null },
    { accountId: 30, amount: 1230, currency: 'EUR', memo: null },
  ] }, EDIT_AT)
  assert.equal(headerOf(db, id).category_source, null)
})

test('整組替換分錄:不平、太少、幣別與帳戶不符、幣別不存在、跟 categories 一起給,都拒絕且不寫入', () => {
  const { db, id, foodPosting } = editLedger()
  const before = postingsOf(db, id)
  const tryPostings = (postings: { accountId: number; amount: number; currency: string; memo: string | null }[]) =>
    fieldsOf(() => updateTransaction(db, id, { expectedUpdatedAt: AT, postings }))
  assert.deepEqual(tryPostings([
    { accountId: ACCOUNTS.wiseEur, amount: -1230, currency: 'EUR', memo: null },
    { accountId: ACCOUNTS.food, amount: 1200, currency: 'EUR', memo: null },
  ]), { postings: 'unbalanced:EUR' })
  assert.deepEqual(tryPostings([{ accountId: ACCOUNTS.wiseEur, amount: 0, currency: 'EUR', memo: null }]), {
    postings: 'too_few', 'postings.0.amount': 'invalid',
  })
  assert.deepEqual(tryPostings([
    { accountId: ACCOUNTS.wiseUsd, amount: -100, currency: 'EUR', memo: null },
    { accountId: ACCOUNTS.food, amount: 100, currency: 'EUR', memo: null },
  ]), { 'postings.0.currency': 'account_currency_mismatch' })
  assert.deepEqual(tryPostings([
    { accountId: ACCOUNTS.food, amount: -100, currency: 'XYZ', memo: null },
    { accountId: 20, amount: 100, currency: 'XYZ', memo: null },
  ]), { 'postings.0.currency': 'not_found', 'postings.1.currency': 'not_found' })
  assert.deepEqual(
    fieldsOf(() => updateTransaction(db, id, { expectedUpdatedAt: AT, categories: [{ postingId: foodPosting, accountId: 20 }], postings: before.map((p) => ({ accountId: p.account_id, amount: p.amount, currency: 'EUR', memo: p.memo })) })),
    { categories: 'with_postings' },
  )
  assert.deepEqual(postingsOf(db, id), before)
  assert.equal(getV2RetiredAt(db), null)
})

test('刪除:分錄與標籤一起刪;匯入的交易記下來源 ID 與快照;寫入 v2 停用', () => {
  const db = freshLedger()
  const imported = createTransaction(db, expense({ externalId: 'X-9', source: 'wise_csv' }), AT)
  const manual = createTransaction(db, expense({ occurredAt: '2030-01-16T09:30:00+00:00' }), AT)
  deleteTransaction(db, imported, AT, EDIT_AT)
  deleteTransaction(db, manual, AT, EDIT_AT)
  assert.equal(count(db, 'finance_transactions'), 0)
  assert.equal(count(db, 'finance_postings'), 0)
  const rows = db.all<{ external_id: string; source: string; deleted_at: string; snapshot: string }>(
    sql`SELECT * FROM finance_deleted_external_ids`,
  )
  assert.equal(rows.length, 1)
  assert.equal(rows[0].external_id, 'X-9')
  assert.equal(rows[0].source, 'wise_csv')
  assert.equal(rows[0].deleted_at, EDIT_STAMP)
  assert.equal(JSON.parse(rows[0].snapshot).postings.length, 2)
  assert.equal(getV2RetiredAt(db), EDIT_STAMP)
})

test('刪除:資料是舊的時拒絕、不存在是 NotFoundError', () => {
  const db = freshLedger()
  const id = createTransaction(db, expense(), AT)
  assert.deepEqual(fieldsOf(() => deleteTransaction(db, id, '2029-01-01T00:00:00+00:00')), { expectedUpdatedAt: 'stale' })
  assert.equal(count(db, 'finance_transactions'), 1)
  assert.throws(() => deleteTransaction(db, 999, AT), NotFoundError)
})

