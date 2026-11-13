import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizePayeeText, payeeDisplayName } from './payees'

const suffixes = ['via Processor']

test('正規化:小寫、去頭尾空白、連續空白合成一個', () => {
  assert.equal(normalizePayeeText('  Some   Shop BV ', []), 'some shop bv')
})

test('正規化:去掉結尾的後綴,不分大小寫', () => {
  assert.equal(normalizePayeeText('Some Shop BV via PROCESSOR', suffixes), 'some shop bv')
  assert.equal(normalizePayeeText('Some Shop BV', suffixes), 'some shop bv')
})

test('後綴只在結尾、而且前面有其他文字時才去掉', () => {
  assert.equal(normalizePayeeText('via Processor shop', suffixes), 'via processor shop')
  assert.equal(normalizePayeeText('via Processor', suffixes), 'via processor')
  assert.equal(normalizePayeeText('Shopvia Processor', suffixes), 'shopvia processor')
})

test('顯示名稱保留大小寫,只整理空白與後綴', () => {
  assert.equal(payeeDisplayName(' Some  Shop BV via Processor', suffixes), 'Some Shop BV')
})
