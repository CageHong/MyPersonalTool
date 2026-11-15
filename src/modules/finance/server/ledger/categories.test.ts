import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sql } from 'drizzle-orm'
import { NotFoundError, ValidationError } from '../errors'
import { ACCOUNTS, AT, freshLedger } from '../testing'
import {
  createCategory,
  deleteCategory,
  listCategories,
  mergeCategory,
  moveCategory,
  updateCategory,
} from './categories'
import { getV2RetiredAt } from './settings'
import { createTransaction } from './transactions'

const NOW = '2030-02-01T00:00:00Z'

function fieldsOf(fn: () => unknown): Record<string, string> {
  try {
    fn()
  } catch (error) {
    assert.ok(error instanceof ValidationError, String(error))
    return error.fields
  }
  assert.fail('應該要丟 ValidationError')
}

// 帳本 + 分類:Food(12,系統帳本裡已有)、Transport(20)> Train(21)、Salary(30,收入);一筆 Food 的支出
function ledger() {
  const db = freshLedger()
  db.run(sql`INSERT INTO finance_accounts (id, name, type, parent_id, sort_order, created_at) VALUES
             (20, 'Transport', 'expense', NULL, 1, ${AT}), (21, 'Train', 'expense', 20, 0, ${AT}),
             (30, 'Salary', 'income', NULL, 0, ${AT})`)
  createTransaction(db, {
    occurredAt: '2030-01-15T09:30:00+00:00',
    source: 'manual',
    postings: [
      { accountId: ACCOUNTS.wiseEur, amount: -500, currency: 'EUR' },
      { accountId: ACCOUNTS.food, amount: 500, currency: 'EUR' },
    ],
  }, AT)
  return db
}

test('清單:上層後面接子分類;附交易筆數與系統分類標記', () => {
  const db = ledger()
  const list = listCategories(db)
  const food = list.find((c) => c.id === ACCOUNTS.food)
  assert.equal(food?.transactions, 1)
  assert.equal(list.find((c) => c.id === ACCOUNTS.uncategorized)?.isSystem, true)
  const expense = list.filter((c) => c.type === 'expense').map((c) => c.id)
  assert.ok(expense.indexOf(21) === expense.indexOf(20) + 1)
})

test('新增:同一層名稱不能重複;上層要是同類型的最上層、不是系統分類;排在最後;寫入 v2 停用', () => {
  const db = ledger()
  const id = createCategory(db, { name: ' Bus ', type: 'expense', parentId: 20 }, NOW)
  assert.deepEqual(listCategories(db).filter((c) => c.parentId === 20).map((c) => c.name), ['Train', 'Bus'])
  assert.ok(id > 0)
  assert.equal(getV2RetiredAt(db), '2030-02-01T00:00:00+00:00')
  assert.deepEqual(fieldsOf(() => createCategory(db, { name: 'Train', type: 'expense', parentId: 20 })), { name: 'duplicate' })
  assert.deepEqual(fieldsOf(() => createCategory(db, { name: 'X', type: 'income', parentId: 20 })), { parentId: 'type_mismatch' })
  assert.deepEqual(fieldsOf(() => createCategory(db, { name: 'X', type: 'expense', parentId: 21 })), { parentId: 'not_top_level' })
  assert.deepEqual(fieldsOf(() => createCategory(db, { name: 'X', type: 'expense', parentId: ACCOUNTS.uncategorized })), { parentId: 'system' })
  assert.deepEqual(fieldsOf(() => createCategory(db, { name: '  ', type: 'expense', parentId: null })), { name: 'required' })
})

test('改名、換上層、封存;系統分類不能改;有子分類的不能放到別人底下', () => {
  const db = ledger()
  updateCategory(db, ACCOUNTS.food, { name: 'Groceries' }, NOW)
  updateCategory(db, 21, { parentId: null }, NOW)
  updateCategory(db, 21, { parentId: ACCOUNTS.food }, NOW)
  updateCategory(db, 30, { isActive: false }, NOW)
  const list = listCategories(db)
  assert.equal(list.find((c) => c.id === ACCOUNTS.food)?.name, 'Groceries')
  assert.equal(list.find((c) => c.id === 21)?.parentId, ACCOUNTS.food)
  assert.equal(list.find((c) => c.id === 30)?.isActive, false)
  assert.deepEqual(fieldsOf(() => updateCategory(db, ACCOUNTS.uncategorized, { name: 'X' })), { category: 'system' })
  assert.deepEqual(fieldsOf(() => updateCategory(db, ACCOUNTS.food, { parentId: 20 })), { parentId: 'has_children' })
  assert.deepEqual(fieldsOf(() => updateCategory(db, 20, { parentId: 20 })), { parentId: 'self' })
  assert.throws(() => updateCategory(db, ACCOUNTS.wiseEur, { name: 'X' }), NotFoundError)
})

test('排序:同一層上移、下移;到頭了不動', () => {
  const db = ledger()
  createCategory(db, { name: 'Bus', type: 'expense', parentId: 20 }, NOW)
  const kids = () => listCategories(db).filter((c) => c.parentId === 20).map((c) => c.name)
  const bus = listCategories(db).find((c) => c.name === 'Bus')!.id
  moveCategory(db, bus, 'up', NOW)
  assert.deepEqual(kids(), ['Bus', 'Train'])
  moveCategory(db, bus, 'up', NOW)
  assert.deepEqual(kids(), ['Bus', 'Train'])
  moveCategory(db, bus, 'down', NOW)
  assert.deepEqual(kids(), ['Train', 'Bus'])
})

test('合併:分錄、規則、週期項目改指向目標,來源刪掉;系統、有子分類、類型不同不行', () => {
  const db = ledger()
  db.run(sql`INSERT INTO finance_payees (id, name, created_at) VALUES (1, 'Shop', ${AT})`)
  db.run(sql`INSERT INTO finance_rules (match_field, payee_id, assign_account_id, created_at) VALUES ('payee', 1, ${ACCOUNTS.food}, ${AT})`)
  db.run(sql`INSERT INTO finance_scheduled_transactions (name, account_id, payee_id, amount_min, amount_max, currency, frequency, created_at)
             VALUES ('Weekly', ${ACCOUNTS.food}, 1, 100, 900, 'EUR', 'weekly', ${AT})`)
  mergeCategory(db, ACCOUNTS.food, 21, NOW)
  const one = (query: string) => db.all<{ v: number }>(sql.raw(query))[0].v
  assert.equal(one(`SELECT COUNT(*) AS v FROM finance_postings WHERE account_id = 21`), 1)
  assert.equal(one(`SELECT assign_account_id AS v FROM finance_rules`), 21)
  assert.equal(one(`SELECT account_id AS v FROM finance_scheduled_transactions`), 21)
  assert.equal(listCategories(db).some((c) => c.id === ACCOUNTS.food), false)
  assert.deepEqual(fieldsOf(() => mergeCategory(db, 20, 21)), { category: 'has_children' })
  assert.deepEqual(fieldsOf(() => mergeCategory(db, ACCOUNTS.uncategorized, 21)), { category: 'system' })
  assert.deepEqual(fieldsOf(() => mergeCategory(db, 21, 30)), { targetId: 'type_mismatch' })
  assert.deepEqual(fieldsOf(() => mergeCategory(db, 21, 21)), { targetId: 'self' })
})

test('刪除:沒被用到才能刪;有交易、有子分類、被規則用到、系統分類都不行', () => {
  const db = ledger()
  const empty = createCategory(db, { name: 'Empty', type: 'income', parentId: null }, NOW)
  deleteCategory(db, empty, NOW)
  assert.equal(listCategories(db).some((c) => c.id === empty), false)
  assert.deepEqual(fieldsOf(() => deleteCategory(db, ACCOUNTS.food)), { category: 'has_transactions' })
  assert.deepEqual(fieldsOf(() => deleteCategory(db, 20)), { category: 'has_children' })
  assert.deepEqual(fieldsOf(() => deleteCategory(db, ACCOUNTS.uncategorized)), { category: 'system' })
  db.run(sql`INSERT INTO finance_rules (match_field, match_value, assign_account_id, created_at) VALUES ('source_category', 'Pay', 30, ${AT})`)
  assert.deepEqual(fieldsOf(() => deleteCategory(db, 30)), { category: 'in_use' })
})
