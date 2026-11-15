import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sql } from 'drizzle-orm'
import { NotFoundError, ValidationError } from '../errors'
import { ACCOUNTS, AT, freshLedger } from '../testing'
import { createRule, deleteRule, listRules, moveRule, updateRule } from './rules'

function fieldsOf(fn: () => unknown): Record<string, string> {
  try {
    fn()
  } catch (error) {
    assert.ok(error instanceof ValidationError, String(error))
    return error.fields
  }
  assert.fail('應該要丟 ValidationError')
}

function ledger() {
  const db = freshLedger()
  db.run(sql`INSERT INTO finance_accounts (id, name, type, created_at) VALUES (20, 'Salary', 'income', ${AT})`)
  db.run(sql`INSERT INTO finance_payees (id, name, created_at) VALUES (1, 'Shop', ${AT}), (2, 'Cafe', ${AT})`)
  return db
}

test('新增:對象規則只能指到支出分類;來源分類規則可以指到收入;排在同一種最後', () => {
  const db = ledger()
  const a = createRule(db, { matchField: 'payee', payeeId: 1, matchValue: null, assignAccountId: ACCOUNTS.food, isActive: true })
  const b = createRule(db, { matchField: 'payee', payeeId: 2, matchValue: null, assignAccountId: ACCOUNTS.food, isActive: true })
  createRule(db, { matchField: 'source_category', payeeId: null, matchValue: ' Salary ', assignAccountId: 20, isActive: true })
  const rules = listRules(db)
  assert.deepEqual(rules.map((r) => [r.id, r.matchField, r.payeeName, r.matchValue, r.priority]).slice(0, 2), [
    [a, 'payee', 'Shop', null, 0],
    [b, 'payee', 'Cafe', null, 1],
  ])
  assert.equal(rules[2].matchValue, 'Salary')
  assert.deepEqual(fieldsOf(() => createRule(db, { matchField: 'payee', payeeId: 1, matchValue: null, assignAccountId: 20, isActive: true })), {
    assignAccountId: 'type_mismatch',
  })
  assert.deepEqual(fieldsOf(() => createRule(db, { matchField: 'payee', payeeId: null, matchValue: null, assignAccountId: ACCOUNTS.food, isActive: true })), {
    payeeId: 'required',
  })
  assert.deepEqual(fieldsOf(() => createRule(db, { matchField: 'source_category', payeeId: null, matchValue: ' ', assignAccountId: 20, isActive: true })), {
    matchValue: 'required',
  })
  assert.deepEqual(fieldsOf(() => createRule(db, { matchField: 'payee', payeeId: 1, matchValue: null, assignAccountId: ACCOUNTS.wiseEur, isActive: true })), {
    assignAccountId: 'type_mismatch',
  })
})

test('修改、停用、排序、刪除', () => {
  const db = ledger()
  const a = createRule(db, { matchField: 'payee', payeeId: 1, matchValue: null, assignAccountId: ACCOUNTS.food, isActive: true })
  const b = createRule(db, { matchField: 'payee', payeeId: 2, matchValue: null, assignAccountId: ACCOUNTS.food, isActive: true })
  updateRule(db, a, { isActive: false, payeeId: 2 })
  assert.deepEqual(listRules(db).find((r) => r.id === a)?.isActive, false)
  assert.deepEqual(fieldsOf(() => updateRule(db, a, { matchValue: 'x' })), { matchValue: 'not_source_rule' })
  moveRule(db, b, 'up')
  assert.deepEqual(listRules(db).map((r) => r.id), [b, a])
  moveRule(db, b, 'up')
  assert.deepEqual(listRules(db).map((r) => r.id), [b, a])
  deleteRule(db, a)
  assert.deepEqual(listRules(db).map((r) => r.id), [b])
  assert.throws(() => deleteRule(db, a), NotFoundError)
})
