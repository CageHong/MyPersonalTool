import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sql } from 'drizzle-orm'
import { parseWiseCsv } from '@personal-tools/statement-parsers'
import type { FinanceDb } from '../../db/index'
import { resolvePayee } from '../ledger/payees'
import { createTransaction, deleteTransaction } from '../ledger/transactions'
import { ACCOUNTS, AT, freshLedger } from '../testing'
import { applyImport, ImportBlockedError, mergeParseResults, planImport } from './index'

const options = { payeeSuffixes: ['via Processor'] }

const COLUMNS = [
  'ID',
  'Status',
  'Direction',
  'Created on',
  'Source fee amount',
  'Source fee currency',
  'Source name',
  'Source amount (after fees)',
  'Source currency',
  'Target name',
  'Target amount (after fees)',
  'Target currency',
  'Exchange rate',
  'Reference',
  'Category',
  'Note',
]

const DEFAULTS: Record<string, string> = {
  ID: 'CARD-1',
  Status: 'COMPLETED',
  Direction: 'OUT',
  'Created on': '2030-01-15 09:30:00',
  'Source fee amount': '0.00',
  'Source fee currency': 'EUR',
  'Source name': 'Alex Example',
  'Source amount (after fees)': '12.30',
  'Source currency': 'EUR',
  'Target name': 'Some Shop BV',
  'Target amount (after fees)': '12.30',
  'Target currency': 'EUR',
  'Exchange rate': '1.0',
}

function statement(rows: Record<string, string>[]) {
  const lines = rows.map((row) => COLUMNS.map((c) => row[c] ?? DEFAULTS[c] ?? '').join(','))
  return parseWiseCsv([COLUMNS.join(','), ...lines].join('\n'))
}

const incoming = (overrides: Record<string, string> = {}) => ({
  ID: 'TRANSFER-1',
  Direction: 'IN',
  'Source name': 'Jordan Sample',
  'Source amount (after fees)': '1000.00',
  'Source currency': 'USD',
  'Target name': 'Alex Example',
  'Target amount (after fees)': '915.40',
  'Target currency': 'EUR',
  ...overrides,
})

const exchange = {
  ID: 'BALANCE-1',
  Direction: 'NEUTRAL',
  'Source amount (after fees)': '200.00',
  'Source currency': 'USD',
  'Source fee amount': '0.80',
  'Source fee currency': 'USD',
  'Target amount (after fees)': '183.20',
  'Target currency': 'EUR',
  'Source name': '',
  'Target name': '',
}

function postingsOf(db: FinanceDb, externalId: string) {
  return db.all<{ account_id: number; amount: number; currency: string }>(
    sql`SELECT p.account_id, p.amount, p.currency FROM finance_postings p
        JOIN finance_transactions t ON t.id = p.transaction_id
        WHERE t.external_id = ${externalId} ORDER BY p.sort_order`,
  )
}

function payeeOf(db: FinanceDb, externalId: string) {
  return (
    db.all<{ name: string | null }>(
      sql`SELECT y.name FROM finance_transactions t LEFT JOIN finance_payees y ON y.id = t.payee_id
          WHERE t.external_id = ${externalId}`,
    )[0]?.name ?? null
  )
}

const unbalanced = (db: FinanceDb) => db.all(sql`SELECT * FROM finance_v_unbalanced`)

// 舊的匯入方式留下來的入帳交易:對象是帳戶持有人自己,金額是匯出方的數字
function seedOldIncoming(db: FinanceDb, amount = 91540) {
  const self = resolvePayee(db, 'Alex Example', options.payeeSuffixes, AT)
  return createTransaction(
    db,
    {
      occurredAt: '2030-01-15T09:30:00+00:00',
      source: 'wise_csv',
      externalId: 'TRANSFER-1',
      payeeId: self,
      postings: [
        { accountId: ACCOUNTS.wiseEur, amount, currency: 'EUR' },
        { accountId: ACCOUNTS.uncategorizedIncome, amount: -amount, currency: 'EUR' },
      ],
    },
    AT,
  )
}

test('付出:來源帳戶 −(金額 + 手續費)、未分類 + 金額、手續費 + 手續費', () => {
  const db = freshLedger()
  const plan = planImport(
    db,
    statement([{ 'Source amount (after fees)': '100.00', 'Source fee amount': '1.25', Note: 'gift' }]),
    options,
  )
  assert.deepEqual(plan.errors, [])
  assert.deepEqual(applyImport(db, plan, options, AT), { created: 1, payeesFixed: 0 })
  assert.deepEqual(postingsOf(db, 'CARD-1'), [
    { account_id: ACCOUNTS.wiseEur, amount: -10125, currency: 'EUR' },
    { account_id: ACCOUNTS.uncategorized, amount: 10000, currency: 'EUR' },
    { account_id: ACCOUNTS.fee, amount: 125, currency: 'EUR' },
  ])
  assert.equal(payeeOf(db, 'CARD-1'), 'Some Shop BV')
  const [header] = db.all<{ note: string; source: string; import_meta: string; occurred_at: string }>(
    sql`SELECT note, source, import_meta, occurred_at FROM finance_transactions`,
  )
  assert.equal(header.note, 'gift')
  assert.equal(header.source, 'wise_csv')
  assert.equal(header.occurred_at, '2030-01-15T09:30:00+00:00')
  const meta = JSON.parse(header.import_meta)
  assert.equal(meta.payee_original, 'Some Shop BV')
  assert.equal(meta.row['Source fee amount'], '1.25')
  assert.deepEqual(unbalanced(db), [])
})

test('入帳:來源帳戶 + 實際入帳金額、未分類收入 − 金額;對象是匯款人', () => {
  const db = freshLedger()
  applyImport(db, planImport(db, statement([incoming()]), options), options)
  assert.deepEqual(postingsOf(db, 'TRANSFER-1'), [
    { account_id: ACCOUNTS.wiseEur, amount: 91540, currency: 'EUR' },
    { account_id: ACCOUNTS.uncategorizedIncome, amount: -91540, currency: 'EUR' },
  ])
  assert.equal(payeeOf(db, 'TRANSFER-1'), 'Jordan Sample')
})

test('換匯:兩個幣別各自平衡,手續費從流出的帳戶扣', () => {
  const db = freshLedger()
  applyImport(db, planImport(db, statement([exchange]), options), options)
  assert.deepEqual(postingsOf(db, 'BALANCE-1'), [
    { account_id: ACCOUNTS.wiseUsd, amount: -20080, currency: 'USD' },
    { account_id: ACCOUNTS.exchange, amount: 20000, currency: 'USD' },
    { account_id: ACCOUNTS.wiseEur, amount: 18320, currency: 'EUR' },
    { account_id: ACCOUNTS.exchange, amount: -18320, currency: 'EUR' },
    { account_id: ACCOUNTS.fee, amount: 80, currency: 'USD' },
  ])
  assert.equal(payeeOf(db, 'BALANCE-1'), null)
  assert.deepEqual(unbalanced(db), [])
})

test('沒有對方名稱時,對象用備註欄', () => {
  const db = freshLedger()
  applyImport(
    db,
    planImport(db, statement([{ 'Target name': '', Reference: 'Monthly Pass' }]), options),
    options,
  )
  assert.equal(payeeOf(db, 'CARD-1'), 'Monthly Pass')
})

test('同一份檔案套用兩次:第二次沒有新的,也不再寫入', () => {
  const db = freshLedger()
  const parsed = statement([{}, incoming(), exchange])
  assert.deepEqual(applyImport(db, planImport(db, parsed, options), options), {
    created: 3,
    payeesFixed: 0,
  })
  const again = planImport(db, parsed, options)
  assert.deepEqual(
    again.items.map((item) => item.status),
    ['existing', 'existing', 'existing'],
  )
  assert.ok(again.items.every((i) => i.status === 'existing' && !i.payeeFix && !i.amountDiff))
  assert.deepEqual(applyImport(db, again, options), { created: 0, payeesFixed: 0 })
  assert.equal(db.all(sql`SELECT * FROM finance_transactions`).length, 3)
  assert.equal(again.missingFromFile, 0)
})

test('補對象:既有的入帳交易對象是帳戶持有人時,換成匯款人;其他欄位不動', () => {
  const db = freshLedger()
  const id = seedOldIncoming(db)
  db.run(sql`INSERT INTO finance_tags (id, name, created_at) VALUES (1, 'trip', ${AT})`)
  db.run(sql`INSERT INTO finance_transaction_tags VALUES (${id}, 1)`)
  const plan = planImport(db, statement([incoming()]), options)
  const [item] = plan.items
  assert.ok(item.status === 'existing')
  assert.deepEqual(item.payeeFix, { from: 'Alex Example', to: 'Jordan Sample' })
  assert.equal(item.amountDiff, null)
  assert.deepEqual(applyImport(db, plan, options), { created: 0, payeesFixed: 1 })
  assert.equal(payeeOf(db, 'TRANSFER-1'), 'Jordan Sample')
  assert.equal(db.all(sql`SELECT * FROM finance_transaction_tags`).length, 1)
  assert.equal(postingsOf(db, 'TRANSFER-1').length, 2)
  // 再跑一次:已經補過,不再列為要補
  const again = planImport(db, statement([incoming()]), options)
  assert.ok(again.items[0].status === 'existing' && again.items[0].payeeFix === null)
})

test('不補對象:匯款人就是持有人自己、對象已經是別人、付出的交易', () => {
  const db = freshLedger()
  seedOldIncoming(db)
  const selfTransfer = planImport(db, statement([incoming({ 'Source name': 'ALEX  EXAMPLE' })]), options)
  assert.ok(selfTransfer.items[0].status === 'existing' && selfTransfer.items[0].payeeFix === null)

  const other = freshLedger()
  resolvePayee(other, 'Alex Example', options.payeeSuffixes)
  createTransaction(other, {
    occurredAt: '2030-01-15T09:30:00+00:00',
    source: 'wise_csv',
    externalId: 'TRANSFER-1',
    payeeId: resolvePayee(other, 'Hand Picked', options.payeeSuffixes),
    postings: [
      { accountId: ACCOUNTS.wiseEur, amount: 91540, currency: 'EUR' },
      { accountId: ACCOUNTS.food, amount: -91540, currency: 'EUR' },
    ],
  })
  const kept = planImport(other, statement([incoming()]), options)
  assert.ok(kept.items[0].status === 'existing' && kept.items[0].payeeFix === null)
  applyImport(other, kept, options)
  assert.equal(payeeOf(other, 'TRANSFER-1'), 'Hand Picked')
})

test('金額不同:只列出來,套用時不改分錄(對象照補)', () => {
  const db = freshLedger()
  seedOldIncoming(db, 100000)
  const plan = planImport(db, statement([incoming()]), options)
  const [item] = plan.items
  assert.ok(item.status === 'existing')
  assert.deepEqual(item.amountDiff, {
    existing: [{ accountId: ACCOUNTS.wiseEur, currency: 'EUR', amount: 100000 }],
    incoming: [{ accountId: ACCOUNTS.wiseEur, currency: 'EUR', amount: 91540 }],
  })
  assert.deepEqual(applyImport(db, plan, options), { created: 0, payeesFixed: 1 })
  assert.equal(postingsOf(db, 'TRANSFER-1')[0].amount, 100000)
})

test('金額只比來源帳戶那一側:分類那一側拆成幾條都算相同', () => {
  const db = freshLedger()
  createTransaction(db, {
    occurredAt: '2030-01-15T09:30:00+00:00',
    source: 'wise_csv',
    externalId: 'CARD-1',
    postings: [
      { accountId: ACCOUNTS.wiseEur, amount: -1230, currency: 'EUR' },
      { accountId: ACCOUNTS.food, amount: 800, currency: 'EUR' },
      { accountId: ACCOUNTS.uncategorized, amount: 430, currency: 'EUR' },
    ],
  })
  const [item] = planImport(db, statement([{}]), options).items
  assert.ok(item.status === 'existing' && item.amountDiff === null)
})

test('帳本沒有對應的帳戶、小數位數不對、檔案裡 ID 重複:列為錯誤,不能套用', () => {
  const db = freshLedger()
  const plan = planImport(
    db,
    statement([
      { ID: 'CARD-1', 'Source currency': 'GBP' },
      { ID: 'CARD-2', 'Source amount (after fees)': '12.345' },
      { ID: 'CARD-3' },
      { ID: 'CARD-3' },
    ]),
    options,
  )
  assert.deepEqual(
    plan.errors.map((error) => [error.line, error.externalId]),
    [
      [2, 'CARD-1'],
      [3, 'CARD-2'],
      [5, 'CARD-3'],
    ],
  )
  assert.match(plan.errors[0].message, /GBP|wise:GBP/)
  assert.equal(plan.items.length, 1)
  assert.throws(() => applyImport(db, plan, options), ImportBlockedError)
  assert.equal(db.all(sql`SELECT * FROM finance_transactions`).length, 0)
})

test('略過的列原樣帶進計畫;帳本有、檔案沒有的筆數', () => {
  const db = freshLedger()
  seedOldIncoming(db)
  const plan = planImport(db, statement([{ Status: 'CANCELLED' }, { ID: 'CARD-2' }]), options)
  assert.equal(plan.skipped.length, 1)
  assert.equal(plan.skipped[0].reason, 'status')
  assert.equal(plan.missingFromFile, 1)
  assert.deepEqual(
    plan.items.map((item) => item.status),
    ['new'],
  )
})

test('套用到一半失敗時整份復原', () => {
  const db = freshLedger()
  const plan = planImport(db, statement([{ ID: 'CARD-1' }, { ID: 'CARD-2' }]), options)
  // 計畫做好之後,帳本被別的地方先寫入了同一個 ID
  createTransaction(db, {
    occurredAt: '2030-01-15T09:30:00+00:00',
    source: 'manual',
    externalId: 'CARD-2',
    postings: [
      { accountId: ACCOUNTS.wiseEur, amount: -100, currency: 'EUR' },
      { accountId: ACCOUNTS.food, amount: 100, currency: 'EUR' },
    ],
  })
  assert.throws(() => applyImport(db, plan, options))
  assert.equal(db.all(sql`SELECT * FROM finance_transactions`).length, 1)
  assert.equal(db.all(sql`SELECT * FROM finance_payees`).length, 0)
})

test('匯款人透過別名對到帳本現在的對象(持有人自己的另一種寫法)時不補', () => {
  const db = freshLedger()
  seedOldIncoming(db)
  db.run(sql`INSERT INTO finance_payee_aliases (alias, payee_id)
             SELECT 'alex-example', payee_id FROM finance_transactions WHERE external_id = 'TRANSFER-1'`)
  const plan = planImport(db, statement([incoming({ 'Source name': 'ALEX-EXAMPLE' })]), options)
  assert.ok(plan.items[0].status === 'existing' && plan.items[0].payeeFix === null)
})

test('補對象時,匯款人的寫法有別名就用別名指到的收款人', () => {
  const db = freshLedger()
  seedOldIncoming(db)
  const known = resolvePayee(db, 'Jordan Q Sample', options.payeeSuffixes)
  db.run(sql`INSERT INTO finance_payee_aliases (alias, payee_id) VALUES ('sample jordan', ${known})`)
  applyImport(db, planImport(db, statement([incoming({ 'Source name': 'SAMPLE JORDAN' })]), options), options)
  assert.equal(payeeOf(db, 'TRANSFER-1'), 'Jordan Q Sample')
})

test('mergeParseResults:重疊的檔案,同一個 ID 只留一筆;略過的列都保留', () => {
  const a = statement([{ ID: 'CARD-1' }, { ID: 'CARD-2' }, { ID: 'CARD-9', Status: 'CANCELLED' }])
  const b = statement([{ ID: 'CARD-2' }, { ID: 'CARD-3' }])
  const { merged, conflicts } = mergeParseResults([a, b])
  assert.deepEqual(conflicts, [])
  assert.deepEqual(
    merged.transactions.map((tx) => tx.externalId),
    ['CARD-1', 'CARD-2', 'CARD-3'],
  )
  assert.equal(merged.skipped.length, 1)
  const db = freshLedger()
  const plan = planImport(db, merged, options)
  assert.deepEqual(plan.errors, [])
  assert.equal(applyImport(db, plan, options).created, 3)
})

test('mergeParseResults:同一個 ID 內容不同時列為衝突,兩筆都不留', () => {
  const a = statement([{ ID: 'CARD-1' }, { ID: 'CARD-2' }])
  const b = statement([{ ID: 'CARD-1', 'Source amount (after fees)': '99.00' }])
  const { merged, conflicts } = mergeParseResults([a, b])
  assert.deepEqual(conflicts, [
    {
      externalId: 'CARD-1',
      lines: [
        { file: 0, line: 2 },
        { file: 1, line: 2 },
      ],
    },
  ])
  assert.deepEqual(
    merged.transactions.map((tx) => tx.externalId),
    ['CARD-2'],
  )
})

test('mergeParseResults:只差在 raw 的欄位(例:完成時間)不算衝突', () => {
  const a = statement([{ ID: 'CARD-1', Reference: 'a' }])
  const b = statement([{ ID: 'CARD-1', Reference: 'a', Category: 'Other' }])
  assert.deepEqual(mergeParseResults([a, b]).conflicts, [])
})

test('mergeParseResults:同一份檔案裡 ID 重複時兩列都留下,由 planImport 列為錯誤(只給一個檔案也一樣)', () => {
  const seconds: Record<string, string>[] = [{ ID: 'CARD-1' }, { ID: 'CARD-1', 'Source amount (after fees)': '99.00' }]
  for (const second of seconds) {
    const { merged, conflicts } = mergeParseResults([statement([{ ID: 'CARD-1' }, second])])
    assert.deepEqual(conflicts, [])
    const db = freshLedger()
    const plan = planImport(db, merged, options)
    assert.deepEqual(
      plan.errors.map((error) => [error.line, error.externalId]),
      [[3, 'CARD-1']],
    )
    assert.throws(() => applyImport(db, plan, options), ImportBlockedError)
  }
})

test('mergeParseResults:三份檔案,衝突列出每一份的行號', () => {
  const a = statement([{ ID: 'CARD-1' }])
  const b = statement([{ ID: 'CARD-2' }, { ID: 'CARD-1' }])
  const c = statement([{ ID: 'CARD-1', 'Source amount (after fees)': '99.00' }])
  assert.deepEqual(mergeParseResults([a, b, c]).conflicts, [
    {
      externalId: 'CARD-1',
      lines: [
        { file: 0, line: 2 },
        { file: 1, line: 3 },
        { file: 2, line: 2 },
      ],
    },
  ])
})

test('mergeParseResults:只有備註或來源分類不同時留第一份,列在 detailDiffs;沒有對方名稱時備註欄不同算衝突', () => {
  const a = statement([{ ID: 'CARD-1', Category: 'Groceries' }])
  const b = statement([{ ID: 'CARD-1', Category: 'General' }])
  const { merged, conflicts, detailDiffs } = mergeParseResults([a, b])
  assert.deepEqual(conflicts, [])
  assert.deepEqual(detailDiffs, [
    {
      externalId: 'CARD-1',
      lines: [
        { file: 0, line: 2 },
        { file: 1, line: 2 },
      ],
    },
  ])
  assert.equal(merged.transactions[0].sourceCategory, 'Groceries')

  const noName = { ID: 'CARD-2', 'Target name': '' }
  const result = mergeParseResults([
    statement([{ ...noName, Reference: 'first text' }]),
    statement([{ ...noName, Reference: 'second text' }]),
  ])
  assert.deepEqual(
    result.conflicts.map((c) => c.externalId),
    ['CARD-2'],
  )
})

test('沒有任何金額的列:試跑就列為錯誤', () => {
  const parsed = statement([{ ID: 'CARD-1' }])
  parsed.transactions[0].movements = []
  const plan = planImport(freshLedger(), parsed, options)
  assert.deepEqual(
    plan.errors.map((error) => error.externalId),
    ['CARD-1'],
  )
  assert.equal(plan.items.length, 0)
})

test('補對象的判斷跟套用用同一套查詢:匯款人的寫法沒有別名但有同名的收款人時,看成同一個', () => {
  const db = freshLedger()
  seedOldIncoming(db)
  // 持有人的收款人改過名字;匯款人的寫法就是新名字,別名表裡沒有 → 套用時會對到持有人自己,所以不用補
  db.run(sql`UPDATE finance_payees SET name = 'A. Example' WHERE name = 'Alex Example'`)
  const plan = planImport(db, statement([incoming({ 'Source name': 'A. Example' })]), options)
  assert.ok(plan.items[0].status === 'existing' && plan.items[0].payeeFix === null)
})

// ── 自動分類 ──────────────────────────────────────────────────────

function headerOf(db: FinanceDb, externalId: string) {
  return db.all<{ category_source: string | null; scheduled_id: number | null }>(
    sql`SELECT category_source, scheduled_id FROM finance_transactions WHERE external_id = ${externalId}`,
  )[0]
}

test('新交易匯入時直接記到決定的分類,連同分類來源;試跑的計畫就看得到', () => {
  const db = freshLedger()
  db.run(sql`INSERT INTO finance_rules (match_field, match_value, assign_account_id, created_at)
             VALUES ('source_category', 'Groceries', ${ACCOUNTS.food}, ${AT})`)
  const plan = planImport(
    db,
    statement([{ Category: 'Groceries', 'Source fee amount': '0.50' }, { ID: 'CARD-2', Category: 'General' }]),
    options,
  )
  const [first, second] = plan.items
  assert.ok(first.status === 'new' && second.status === 'new')
  assert.equal(first.classification.categorySource, 'source_category')
  assert.equal(second.classification.accountId, null)

  applyImport(db, plan, options, AT)
  assert.deepEqual(postingsOf(db, 'CARD-1'), [
    { account_id: ACCOUNTS.wiseEur, amount: -1280, currency: 'EUR' },
    { account_id: ACCOUNTS.food, amount: 1230, currency: 'EUR' },
    { account_id: ACCOUNTS.fee, amount: 50, currency: 'EUR' },
  ])
  assert.deepEqual(headerOf(db, 'CARD-1'), { category_source: 'source_category', scheduled_id: null })
  assert.equal(postingsOf(db, 'CARD-2')[1].account_id, ACCOUNTS.uncategorized)
  assert.deepEqual(headerOf(db, 'CARD-2'), { category_source: null, scheduled_id: null })
  assert.deepEqual(unbalanced(db), [])
})

test('週期項目:配對到的交易連結項目、記到項目的分類', () => {
  const db = freshLedger()
  const shop = resolvePayee(db, 'Some Shop BV', options.payeeSuffixes, AT)
  db.run(sql`INSERT INTO finance_scheduled_transactions
             (id, name, account_id, payee_id, amount_min, amount_max, currency, frequency, created_at)
             VALUES (4, 'Weekly box', ${ACCOUNTS.food}, ${shop}, 1000, 1500, 'EUR', 'weekly', ${AT})`)
  applyImport(db, planImport(db, statement([{}]), options), options, AT)
  assert.deepEqual(headerOf(db, 'CARD-1'), { category_source: 'scheduled', scheduled_id: 4 })
  assert.equal(postingsOf(db, 'CARD-1')[1].account_id, ACCOUNTS.food)
})

test('對象歷史:收款人第一次以新的寫法出現,但同名的收款人已經有歷史', () => {
  const db = freshLedger()
  // 帳本裡已經有同名的收款人(沒有這個寫法的別名),而且使用者把它分類過
  db.run(sql`INSERT INTO finance_payees (id, name, created_at) VALUES (40, 'Some Shop BV', ${AT})`)
  createTransaction(
    db,
    {
      occurredAt: '2030-01-01T00:00:00+00:00',
      source: 'manual',
      payeeId: 40,
      categorySource: 'legacy',
      postings: [
        { accountId: ACCOUNTS.wiseEur, amount: -500, currency: 'EUR' },
        { accountId: ACCOUNTS.food, amount: 500, currency: 'EUR' },
      ],
    },
    AT,
  )
  const plan = planImport(db, statement([{}]), options)
  assert.ok(plan.items[0].status === 'new')
  assert.equal(plan.items[0].classification.categorySource, 'payee_history')
  applyImport(db, plan, options, AT)
  assert.equal(postingsOf(db, 'CARD-1')[1].account_id, ACCOUNTS.food)
  assert.equal(payeeOf(db, 'CARD-1'), 'Some Shop BV')
})

test('入帳:來源分類指到支出分類 = 沖銷;換匯不分類;既有交易的分類不動', () => {
  const db = freshLedger()
  db.run(sql`INSERT INTO finance_rules (match_field, match_value, assign_account_id, created_at)
             VALUES ('source_category', 'Groceries', ${ACCOUNTS.food}, ${AT})`)
  seedOldIncoming(db)
  const refund = incoming({
    ID: 'TRANSFER-2',
    'Source currency': 'EUR',
    'Source amount (after fees)': '4.00',
    'Target amount (after fees)': '4.00',
    Category: 'Groceries',
  })
  const plan = planImport(db, statement([refund, exchange, incoming({ Category: 'Groceries' })]), options)
  applyImport(db, plan, options, AT)
  assert.deepEqual(postingsOf(db, 'TRANSFER-2'), [
    { account_id: ACCOUNTS.wiseEur, amount: 400, currency: 'EUR' },
    { account_id: ACCOUNTS.food, amount: -400, currency: 'EUR' },
  ])
  assert.deepEqual(headerOf(db, 'BALANCE-1'), { category_source: null, scheduled_id: null })
  // TRANSFER-1 是既有的:仍在未分類收入
  assert.equal(postingsOf(db, 'TRANSFER-1')[1].account_id, ACCOUNTS.uncategorizedIncome)
  assert.deepEqual(unbalanced(db), [])
})

test('帳本裡刪掉過的交易:列為刪掉過,套用時不加回來;其他列照常', () => {
  const db = freshLedger()
  const parsed = statement([{ ID: 'CARD-1' }, { ID: 'CARD-2', 'Created on': '2030-01-16 09:30:00' }])
  applyImport(db, planImport(db, parsed, options), options, AT)
  const [row] = db.all<{ id: number; updated_at: string }>(
    sql`SELECT id, updated_at FROM finance_transactions WHERE external_id = 'CARD-1'`,
  )
  deleteTransaction(db, row.id, row.updated_at, '2030-02-01T00:00:00Z')

  const plan = planImport(db, parsed, options)
  assert.deepEqual(
    plan.items.map((item) => [item.pending.externalId, item.status]),
    [['CARD-1', 'deleted'], ['CARD-2', 'existing']],
  )
  assert.deepEqual(applyImport(db, plan, options, AT), { created: 0, payeesFixed: 0 })
  assert.equal(db.all(sql`SELECT * FROM finance_transactions`).length, 1)
})

