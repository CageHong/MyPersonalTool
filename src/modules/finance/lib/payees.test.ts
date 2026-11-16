import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parsePayeeSort, sortPayees } from './payees'

const rows = [
  { name: 'zeta', transactionCount: 2 },
  { name: 'Alpha', transactionCount: 1 },
  { name: 'beta', transactionCount: 2 },
  { name: 'Gamma', transactionCount: 9 },
]

test('收款人排序:名稱不分大小寫', () => {
  assert.deepEqual(sortPayees(rows, 'name').map((r) => r.name), ['Alpha', 'beta', 'Gamma', 'zeta'])
})

test('收款人排序:筆數由多到少,同筆數依名稱;不改動原陣列', () => {
  assert.deepEqual(sortPayees(rows, 'count').map((r) => r.name), ['Gamma', 'beta', 'zeta', 'Alpha'])
  assert.equal(rows[0].name, 'zeta')
})

test('收款人排序的網址參數:認不得的值當成名稱', () => {
  assert.equal(parsePayeeSort('count'), 'count')
  assert.equal(parsePayeeSort('name'), 'name')
  assert.equal(parsePayeeSort(null), 'name')
  assert.equal(parsePayeeSort('amount'), 'name')
})
