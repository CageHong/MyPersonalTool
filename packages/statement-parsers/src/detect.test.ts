import assert from 'node:assert/strict'
import { test } from 'node:test'
import { detectSource, parseStatement } from './detect'
import { wiseCsv } from './testing'

test('Wise 的欄位組合認得出來(開頭有 BOM 也一樣)', () => {
  assert.equal(detectSource(wiseCsv([{}])), 'wise_csv')
  assert.equal(detectSource('﻿' + wiseCsv([{}])), 'wise_csv')
})

test('其他 CSV、空檔案認不出來', () => {
  assert.equal(detectSource('Date,Amount\n2030-01-01,5\n'), null)
  assert.equal(detectSource(''), null)
  assert.equal(parseStatement('Date,Amount\n2030-01-01,5\n'), null)
})

test('parseStatement:偵測後交給對應的解析器', () => {
  const result = parseStatement(wiseCsv([{}, { ID: 'CARD-1002' }]))
  assert.equal(result?.source, 'wise_csv')
  assert.equal(result?.transactions.length, 2)
})
