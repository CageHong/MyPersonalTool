import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { localDate, localTime } from './date'

describe('localDate', () => {
  test('pads single-digit month and day with leading zeros', () => {
    assert.equal(localDate(new Date(2026, 0, 5, 12, 0)), '2026-01-05')
  })

  test('formats two-digit month and day', () => {
    assert.equal(localDate(new Date(2026, 10, 22, 9, 30)), '2026-11-22')
  })

  test('handles midnight boundary (23:59 vs 00:00)', () => {
    assert.equal(localDate(new Date(2026, 8, 19, 23, 59)), '2026-09-19')
    assert.equal(localDate(new Date(2026, 8, 20, 0, 0)), '2026-09-20')
  })
})

describe('localTime', () => {
  test('pads single-digit hour and minute with leading zeros', () => {
    assert.equal(localTime(new Date(2026, 0, 5, 0, 0)), '00:00')
    assert.equal(localTime(new Date(2026, 0, 5, 7, 5)), '07:05')
  })

  test('formats two-digit hour and minute', () => {
    assert.equal(localTime(new Date(2026, 0, 5, 23, 59)), '23:59')
  })
})
