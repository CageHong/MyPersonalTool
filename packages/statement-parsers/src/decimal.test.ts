import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canonicalDecimal, isUnsignedDecimal, isZeroDecimal } from './decimal'

test('isUnsignedDecimal:只接受不帶符號的十進位數字', () => {
  for (const ok of ['0', '12', '12.30', '0.05']) assert.equal(isUnsignedDecimal(ok), true, ok)
  for (const bad of ['', '-1', '+1', '1,234.5', '1.', '.5', '1e3', 'abc', ' 1']) {
    assert.equal(isUnsignedDecimal(bad), false, bad)
  }
})

test('isZeroDecimal', () => {
  assert.equal(isZeroDecimal('0'), true)
  assert.equal(isZeroDecimal('0.00'), true)
  assert.equal(isZeroDecimal('0.01'), false)
})

test('canonicalDecimal:同一個數值只有一種寫法', () => {
  assert.equal(canonicalDecimal('12.30'), '12.3')
  assert.equal(canonicalDecimal('12.00'), '12')
  assert.equal(canonicalDecimal('012.5'), '12.5')
  assert.equal(canonicalDecimal('-0.50'), '-0.5')
  assert.equal(canonicalDecimal('-0.00'), '0')
  assert.equal(canonicalDecimal('100'), '100')
})
