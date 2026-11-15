import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildTemplatePostings, reconcileCategoryType } from './templates'
import type { FinanceLookups } from './transactions'

const acc = (id: number, type: FinanceLookups['accounts'][number]['type'], currency: string | null) => ({
  id, name: `A${id}`, type, subtype: null, parentId: null, currency, isActive: true,
})
const lookups: FinanceLookups = {
  displayCurrency: 'EUR',
  exponents: { EUR: 2, USD: 2 },
  accounts: [acc(1, 'asset', 'EUR'), acc(2, 'asset', 'EUR'), acc(3, 'asset', 'USD'), acc(10, 'expense', null), acc(20, 'income', null)],
  tags: [],
  payees: [],
  system: { uncategorizedExpense: 10, uncategorizedIncome: 20, fee: 11, exchange: 30 },
}
const sum = (postings: { amount: number; currency: string }[], currency: string) =>
  postings.filter((p) => p.currency === currency).reduce((total, p) => total + p.amount, 0)

test('支出、收入:帳戶與分類兩條,幣別取帳戶的', () => {
  const out = buildTemplatePostings({ template: 'expense', accountId: 1, amount: 1230, categoryId: 10 }, lookups)
  assert.deepEqual(out.ok && out.postings.map((p) => [p.accountId, p.amount, p.currency]), [[1, -1230, 'EUR'], [10, 1230, 'EUR']])
  const income = buildTemplatePostings({ template: 'income', accountId: 3, amount: 500, categoryId: 20 }, lookups)
  assert.deepEqual(income.ok && income.postings.map((p) => [p.accountId, p.amount, p.currency]), [[3, 500, 'USD'], [20, -500, 'USD']])
})

test('轉帳:同幣別;幣別不同、同一個帳戶、金額不大於零都不行', () => {
  const out = buildTemplatePostings({ template: 'transfer', fromId: 1, toId: 2, amount: 100 }, lookups)
  assert.deepEqual(out.ok && out.postings.map((p) => [p.accountId, p.amount]), [[1, -100], [2, 100]])
  assert.equal(buildTemplatePostings({ template: 'transfer', fromId: 1, toId: 3, amount: 100 }, lookups).ok, false)
  assert.equal(buildTemplatePostings({ template: 'transfer', fromId: 1, toId: 1, amount: 100 }, lookups).ok, false)
  assert.equal(buildTemplatePostings({ template: 'transfer', fromId: 1, toId: 2, amount: 0 }, lookups).ok, false)
})

test('換匯:兩個幣別各自對到換匯帳戶、各自平衡;同幣別不行', () => {
  const out = buildTemplatePostings({ template: 'exchange', fromId: 1, fromAmount: 9000, toId: 3, toAmount: 10000 }, lookups)
  assert.ok(out.ok)
  if (out.ok) {
    assert.equal(sum(out.postings, 'EUR'), 0)
    assert.equal(sum(out.postings, 'USD'), 0)
    assert.deepEqual(out.postings.filter((p) => p.accountId === 30).map((p) => p.amount), [9000, -10000])
  }
  assert.equal(buildTemplatePostings({ template: 'exchange', fromId: 1, fromAmount: 1, toId: 2, toAmount: 1 }, lookups).ok, false)
})

test('對帳調整:帳戶吸收差額、分類相反;差額為零不用調整;差額的正負決定分類類型', () => {
  const out = buildTemplatePostings({ template: 'reconcile', accountId: 1, difference: -250, categoryId: 10 }, lookups)
  assert.deepEqual(out.ok && out.postings.map((p) => [p.accountId, p.amount]), [[1, -250], [10, 250]])
  assert.equal(buildTemplatePostings({ template: 'reconcile', accountId: 1, difference: 0, categoryId: 10 }, lookups).ok, false)
  assert.equal(reconcileCategoryType(-1), 'expense')
  assert.equal(reconcileCategoryType(1), 'income')
})
