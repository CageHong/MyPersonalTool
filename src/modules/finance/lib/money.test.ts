import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatAmount, formatMoney } from './money'

test('formatAmount:小數位數、千分位、負號', () => {
  assert.equal(formatAmount(1234567, 2), '12,345.67')
  assert.equal(formatAmount(5, 2), '0.05')
  assert.equal(formatAmount(-1250, 2), '−12.50')
  assert.equal(formatAmount(1000, 0), '1,000')
  assert.equal(formatAmount(0, 2), '0.00')
})

test('formatMoney:不認得的幣別當成沒有小數', () => {
  assert.equal(formatMoney(1230, 'EUR', { EUR: 2 }), '12.30 EUR')
  assert.equal(formatMoney(1230, 'XYZ', {}), '1,230 XYZ')
})
