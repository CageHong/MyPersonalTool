import assert from 'node:assert/strict'
import { test } from 'node:test'
import { amountInputValue, formatAmount, formatMoney, parseAmount } from './money'

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

test('parseAmount:輸入文字 → 最小單位的整數', () => {
  assert.equal(parseAmount('12.3', 2), 1230)
  assert.equal(parseAmount('1,234.56', 2), 123456)
  assert.equal(parseAmount('.5', 2), 50)
  assert.equal(parseAmount('-7', 2), -700)
  assert.equal(parseAmount('300', 0), 300)
  assert.equal(parseAmount('1.234', 2), null)
  assert.equal(parseAmount('1.5', 0), null)
  assert.equal(parseAmount('', 2), null)
  assert.equal(parseAmount('abc', 2), null)
  assert.equal(parseAmount('.', 2), null)
})

test('amountInputValue:整數 → 輸入框的文字', () => {
  assert.equal(amountInputValue(123456, 2), '1234.56')
  assert.equal(amountInputValue(-50, 2), '-0.50')
  assert.equal(amountInputValue(300, 0), '300')
})
