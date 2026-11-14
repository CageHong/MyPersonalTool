import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sql } from 'drizzle-orm'
import { AT, freshLedger } from '../testing'
import { decide, historyDecisions, loadClassifyContext } from './index'
import type { ClassifyContext, ClassifyInput } from './index'

// 虛構的分類:12 Food(來自 testing)、20 Transport、21 Transport/Train、22 Bonus(收入)
const FOOD = 12
const TRANSPORT = 20
const TRAIN = 21
const BONUS = 22

const ctx = (overrides: Partial<ClassifyContext> = {}): ClassifyContext => ({
  scheduled: [],
  accountTypes: new Map([
    [FOOD, 'expense'],
    [TRANSPORT, 'expense'],
    [TRAIN, 'expense'],
    [BONUS, 'income'],
  ]),
  payeeRules: new Map(),
  sourceRules: new Map(),
  history: new Map(),
  ...overrides,
})

const out = (overrides: Partial<ClassifyInput> = {}): ClassifyInput => ({
  kind: 'out',
  payeeId: 5,
  sourceCategory: 'Groceries',
  occurredAt: '2030-02-01T10:00:00Z',
  amounts: [{ currency: 'EUR', amount: 1000 }],
  ...overrides,
})

const scheduledTrain = {
  id: 9,
  accountId: TRAIN,
  payeeId: 5,
  amountMin: 500,
  amountMax: 1500,
  currency: 'EUR',
  startsOn: null,
  endsOn: null,
}

test('對象歷史:最上層佔比 ≥ 80% 才沿用,記到該上層底下最常見的帳戶', () => {
  const topOf = (id: number) => (id === TRAIN ? TRANSPORT : id)
  const rows = [
    ...Array.from({ length: 5 }, () => ({ payeeId: 1, accountId: TRAIN })),
    ...Array.from({ length: 3 }, () => ({ payeeId: 1, accountId: TRANSPORT })),
    { payeeId: 1, accountId: FOOD },
    // 收款人 2:3 / 4 = 75%,不夠
    ...Array.from({ length: 3 }, () => ({ payeeId: 2, accountId: FOOD })),
    { payeeId: 2, accountId: TRANSPORT },
  ]
  const decisions = historyDecisions(rows, topOf)
  assert.equal(decisions.get(1), TRAIN) // 8 / 9 在 Transport,其中 Train 最多
  assert.equal(decisions.has(2), false)
})

test('對象歷史:同次數取 id 小的', () => {
  const rows = [
    { payeeId: 1, accountId: TRAIN },
    { payeeId: 1, accountId: TRANSPORT },
  ]
  assert.equal(historyDecisions(rows, () => TRANSPORT).get(1), TRANSPORT)
})

test('付出的順序:週期項目 → 對象規則 → 對象歷史 → 來源分類', () => {
  const all = ctx({
    scheduled: [scheduledTrain],
    payeeRules: new Map([[5, TRANSPORT]]),
    history: new Map([[5, FOOD]]),
    sourceRules: new Map([['Groceries', FOOD]]),
  })
  assert.deepEqual(decide(out(), all), {
    accountId: TRAIN,
    categorySource: 'scheduled',
    scheduledId: 9,
    ambiguousScheduled: [],
  })
  const noSchedule = { ...all, scheduled: [] }
  assert.equal(decide(out(), noSchedule).categorySource, 'rule')
  const noRule = { ...noSchedule, payeeRules: new Map() }
  assert.equal(decide(out(), noRule).categorySource, 'payee_history')
  const noHistory = { ...noRule, history: new Map() }
  assert.deepEqual(decide(out(), noHistory), {
    accountId: FOOD,
    categorySource: 'source_category',
    scheduledId: null,
    ambiguousScheduled: [],
  })
  assert.equal(decide(out({ sourceCategory: 'General' }), noHistory).accountId, null)
})

test('週期項目的分類不是支出分類時不用它,照下面的順序繼續', () => {
  const c = ctx({ scheduled: [{ ...scheduledTrain, accountId: BONUS }], payeeRules: new Map([[5, FOOD]]) })
  assert.deepEqual(
    [decide(out(), c).accountId, decide(out(), c).categorySource, decide(out(), c).scheduledId],
    [FOOD, 'rule', null],
  )
})

test('沒有收款人時只看來源分類', () => {
  const c = ctx({ history: new Map([[5, TRAIN]]), sourceRules: new Map([['Groceries', FOOD]]) })
  assert.equal(decide(out({ payeeId: null }), c).accountId, FOOD)
})

test('週期項目同時符合兩個:不配對、回報,繼續往下決定', () => {
  const c = ctx({
    scheduled: [scheduledTrain, { ...scheduledTrain, id: 10 }],
    history: new Map([[5, TRANSPORT]]),
  })
  assert.deepEqual(decide(out(), c), {
    accountId: TRANSPORT,
    categorySource: 'payee_history',
    scheduledId: null,
    ambiguousScheduled: [9, 10],
  })
})

test('分類那一側有兩個幣別時不配對週期項目', () => {
  const c = ctx({ scheduled: [scheduledTrain] })
  const amounts = [
    { currency: 'EUR', amount: 1000 },
    { currency: 'USD', amount: 1000 },
  ]
  assert.equal(decide(out({ amounts }), c).scheduledId, null)
})

test('入帳只看來源分類;規則指到支出分類 = 沖銷', () => {
  const c = ctx({
    payeeRules: new Map([[5, TRANSPORT]]),
    history: new Map([[5, TRANSPORT]]),
    sourceRules: new Map([
      ['Bonus', BONUS],
      ['Groceries', FOOD],
    ]),
  })
  assert.equal(decide(out({ kind: 'in', sourceCategory: 'Bonus' }), c).accountId, BONUS)
  assert.equal(decide(out({ kind: 'in', sourceCategory: 'Groceries' }), c).accountId, FOOD)
  assert.equal(decide(out({ kind: 'in', sourceCategory: null }), c).accountId, null)
})

test('付出不會被記到收入分類', () => {
  const c = ctx({ sourceRules: new Map([['Bonus', BONUS]]), payeeRules: new Map([[5, BONUS]]) })
  assert.equal(decide(out({ sourceCategory: 'Bonus' }), c).accountId, null)
})

test('loadClassifyContext:歷史只算使用者給的借方分錄;規則取優先的、略過停用的', () => {
  const db = freshLedger()
  db.run(sql`INSERT INTO finance_accounts (id, name, type, parent_id, created_at) VALUES
             (20, 'Transport', 'expense', NULL, ${AT}), (21, 'Train', 'expense', 20, ${AT}),
             (22, 'Bonus', 'income', NULL, ${AT})`)
  db.run(sql`INSERT INTO finance_payees (id, name, created_at) VALUES
             (1, 'Rail Co', ${AT}), (2, 'Corner Shop', ${AT})`)
  let tx = 100
  const add = (payeeId: number, account: number, amount: number, source: string | null) => {
    tx++
    db.run(sql`INSERT INTO finance_transactions (id, occurred_at, payee_id, source, category_source, created_at, updated_at)
               VALUES (${tx}, ${AT}, ${payeeId}, 'manual', ${source}, ${AT}, ${AT})`)
    db.run(sql`INSERT INTO finance_postings (transaction_id, account_id, amount, currency) VALUES
               (${tx}, ${account}, ${amount}, 'EUR'), (${tx}, 1, ${-amount}, 'EUR')`)
  }
  add(1, TRAIN, 500, 'legacy')
  add(1, TRAIN, 500, 'correction')
  // 自動分類的結果不算:不然 Rail Co 會變成 1 / 3 在 Food
  add(1, FOOD, 500, 'payee_history')
  add(1, FOOD, 500, 'source_category')
  // 沖銷(貸方)不算
  add(2, FOOD, 500, 'legacy')
  add(2, TRANSPORT, -500, 'legacy')
  db.run(sql`INSERT INTO finance_rules (match_field, payee_id, match_value, assign_account_id, priority, is_active, created_at) VALUES
             ('payee', 2, NULL, 20, 5, 1, ${AT}),
             ('payee', 2, NULL, 12, 1, 0, ${AT}),
             ('payee', 2, NULL, 21, 9, 1, ${AT}),
             ('source_category', NULL, 'Bonus', 22, 90, 1, ${AT})`)

  const loaded = loadClassifyContext(db)
  assert.deepEqual([...loaded.history].sort((a, b) => a[0] - b[0]), [
    [1, TRAIN],
    [2, FOOD],
  ])
  assert.deepEqual([...loaded.payeeRules], [[2, TRANSPORT]])
  assert.deepEqual([...loaded.sourceRules], [['Bonus', BONUS]])
  assert.equal(loaded.accountTypes.get(BONUS), 'income')
})
