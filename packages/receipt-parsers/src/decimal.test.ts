import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  amountsEqual,
  normalizeCommaMoney,
  numberToMoneyString,
  sumAmounts,
} from './decimal'

describe('decimal helpers', () => {
  it('sums decimal strings without floating-point drift', () => {
    assert.equal(sumAmounts(['0.10', '0.20']), '0.30')
    assert.equal(sumAmounts(['1.40', '-0.32', '4.78', '-1.00']), '4.86')
    assert.equal(amountsEqual(sumAmounts(['0.10', '0.20']), '0.30'), true)
  })

  it('normalizes comma-decimal money and rejects >2 decimal numbers', () => {
    assert.equal(normalizeCommaMoney('1,40'), '1.40')
    assert.equal(normalizeCommaMoney('-0,32'), '-0.32')
    assert.equal(numberToMoneyString(3.5), '3.50')
    assert.equal(numberToMoneyString(1.234), null)
    assert.equal(numberToMoneyString(Number.NaN), null)
  })
})
