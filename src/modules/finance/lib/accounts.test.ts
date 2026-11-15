import assert from 'node:assert/strict'
import { test } from 'node:test'
import { balanceAccountOptions, categoryOptions } from './accounts'
import type { FinanceLookups } from './transactions'

const account = (id: number, name: string, type: FinanceLookups['accounts'][number]['type'], extra: Partial<FinanceLookups['accounts'][number]> = {}) => ({
  id, name, type, subtype: null, parentId: null, currency: null, isActive: true, ...extra,
})

const lookups: FinanceLookups = {
  displayCurrency: 'EUR',
  exponents: { EUR: 2 },
  accounts: [
    account(1, 'Bank', 'asset', { currency: 'EUR' }),
    account(2, 'Old Bank', 'asset', { currency: 'EUR', isActive: false }),
    account(3, 'Card', 'liability', { currency: 'EUR' }),
    account(10, 'Food', 'expense'),
    account(11, 'Snacks', 'expense', { parentId: 10 }),
    account(12, 'Fee', 'expense'),
    account(13, 'Hobby', 'expense', { isActive: false }),
    account(14, 'Model kits', 'expense', { parentId: 13 }),
    account(20, 'Salary', 'income'),
  ],
  tags: [],
  payees: [],
  system: { uncategorizedExpense: 99, uncategorizedIncome: 98, fee: 12, exchange: 97 },
}

test('分類選單:同類型、不含手續費、上層後面接子分類;上層封存的子分類放最後;封存的只有目前選的', () => {
  assert.deepEqual(categoryOptions(lookups, 'expense').map((o) => o.label), ['Food', 'Food / Snacks', 'Hobby / Model kits'])
  assert.deepEqual(categoryOptions(lookups, 'expense', 13).map((o) => o.id), [10, 11, 13, 14])
  assert.deepEqual(categoryOptions(lookups, 'income').map((o) => o.label), ['Salary'])
})

test('資產負債帳戶選單:使用中的、帶幣別、依名稱排序', () => {
  assert.deepEqual(balanceAccountOptions(lookups).map((o) => o.label), ['Bank(EUR)', 'Card(EUR)'])
})
