import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AmountError, toMinorUnits } from './amounts'

test('依小數位數換成整數', () => {
  assert.equal(toMinorUnits('12.30', 2), 1230)
  assert.equal(toMinorUnits('12.3', 2), 1230)
  assert.equal(toMinorUnits('12', 2), 1200)
  assert.equal(toMinorUnits('0.05', 2), 5)
  assert.equal(toMinorUnits('-915.40', 2), -91540)
  assert.equal(toMinorUnits('1500', 0), 1500)
  assert.equal(toMinorUnits('-0.00', 2), 0)
})

test('多出來的小數位是 0 時可以接受', () => {
  assert.equal(toMinorUnits('1500.00', 0), 1500)
  assert.equal(toMinorUnits('12.300', 2), 1230)
})

test('多出來的小數位不是 0 時丟錯誤,不四捨五入', () => {
  assert.throws(() => toMinorUnits('1500.50', 0), AmountError)
  assert.throws(() => toMinorUnits('12.305', 2), AmountError)
})

test('不是十進位數字、金額太大時丟錯誤', () => {
  for (const bad of ['', 'abc', '1,200.00', '1e3', '+5', '.5']) {
    assert.throws(() => toMinorUnits(bad, 2), AmountError, bad)
  }
  assert.throws(() => toMinorUnits('99999999999999999', 2), AmountError)
})

test('不經過浮點數:0.1 + 0.2 這類數字不會有誤差', () => {
  assert.equal(toMinorUnits('0.29', 2), 29)
  assert.equal(toMinorUnits('1.15', 2), 115)
  assert.equal(toMinorUnits('4.35', 2), 435)
})
