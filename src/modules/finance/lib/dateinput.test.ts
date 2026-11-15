// 時區固定成比利時,才測得到夏令時間的換算。node --test 每個檔案各自一個行程,不影響其他測試
process.env.TZ = 'Europe/Brussels'

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fromLocalInputValue, toLocalInputValue } from './date'

test('UTC ↔ 當地時間的欄位值:冬令 +1、夏令 +2', () => {
  assert.equal(toLocalInputValue('2026-01-10T23:30:05+00:00'), '2026-01-11T00:30:05')
  assert.equal(toLocalInputValue('2026-07-10T10:00:00Z'), '2026-07-10T12:00:00')
  assert.equal(fromLocalInputValue('2026-01-11T00:30:05'), '2026-01-10T23:30:05.000Z')
  assert.equal(fromLocalInputValue('2026-07-10T12:00'), '2026-07-10T10:00:00.000Z')
})

test('欄位值不合法:格式不對、不存在的日期', () => {
  assert.equal(fromLocalInputValue(''), null)
  assert.equal(fromLocalInputValue('2026-02-30T10:00'), null)
  assert.equal(fromLocalInputValue('2026-02-10 10:00'), null)
})
