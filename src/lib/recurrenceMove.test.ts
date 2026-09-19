import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { RecurrenceSpec } from './recurrence'
import {
  movesInstance,
  needsScopeQuestion,
  onlyThisText,
  wholeRuleChanges,
  wholeRuleText,
} from './recurrenceMove'

// 2026-09-19 週六;9/21 週一、9/23 週三、9/24 週四、9/25 週五
const TODAY = '2026-09-19'
const MONDAY = 1 << 0
const WEDNESDAY = 1 << 2
const THURSDAY = 1 << 3
const FRIDAY = 1 << 4

function rule(overrides: Partial<RecurrenceSpec> = {}): RecurrenceSpec {
  return { freq: 'weekly', interval: 1, weekdays: WEDNESDAY, startDate: '2026-09-23', until: null, ...overrides }
}

describe('wholeRuleChanges', () => {
  test('weekly Wednesday moved to Thursday becomes Thursday', () => {
    assert.deepEqual(wholeRuleChanges(rule(), '2026-09-23', '2026-09-24'), {
      startDate: '2026-09-24',
      weekdays: THURSDAY,
    })
  })

  test('only the moved slot changes: Mon+Thu, Thursday → Friday gives Mon+Fri', () => {
    const monThu = rule({ weekdays: MONDAY | THURSDAY, startDate: '2026-09-21' })

    assert.equal(wholeRuleChanges(monThu, '2026-09-24', '2026-09-25').weekdays, MONDAY | FRIDAY)
  })

  test('moving onto an existing day merges the two slots: Mon+Thu, Thursday → Monday', () => {
    const monThu = rule({ weekdays: MONDAY | THURSDAY, startDate: '2026-09-21' })

    assert.equal(wholeRuleChanges(monThu, '2026-09-24', '2026-09-28').weekdays, MONDAY)
  })

  test('monthly and daily only move the anchor', () => {
    assert.deepEqual(
      wholeRuleChanges(rule({ freq: 'monthly', weekdays: null }), '2026-09-23', '2026-09-25'),
      { startDate: '2026-09-25' },
    )
    assert.deepEqual(
      wholeRuleChanges(rule({ freq: 'daily', interval: 3, weekdays: null }), '2026-09-23', '2026-09-24'),
      { startDate: '2026-09-24' },
    )
  })
})

describe('explanations', () => {
  test('only this one', () => {
    assert.equal(onlyThisText(rule(), '2026-09-23', '2026-09-24', TODAY), '9.23 → 9.24，之後仍是每週三')
  })

  test('whole rule, future instance, reflects the real weekdays', () => {
    const monThu = rule({ weekdays: MONDAY | THURSDAY, startDate: '2026-09-21' })

    assert.equal(
      wholeRuleText(monThu, '2026-09-24', '2026-09-24', '2026-09-25', TODAY),
      '改成每週一、五，9.25 之後每一次都依新規則',
    )
  })

  test('whole rule, today instance stays and the rule changes from tomorrow', () => {
    const saturday = rule({ weekdays: 1 << 5, startDate: TODAY })

    assert.equal(
      wholeRuleText(saturday, TODAY, TODAY, '2026-09-20', TODAY),
      '這一次維持 9.19；從明天起改成每週日',
    )
  })

  test('future instances move; today and overdue do not', () => {
    assert.equal(movesInstance('2026-09-20', TODAY), true)
    assert.equal(movesInstance(TODAY, TODAY), false)
    assert.equal(movesInstance('2026-09-18', TODAY), false)
  })
})

describe('needsScopeQuestion', () => {
  const all = { isInstance: true, ruleStopped: false, dateChanged: true, ruleChanged: false }

  test('asks only when every condition holds', () => {
    assert.equal(needsScopeQuestion(all), true)
    assert.equal(needsScopeQuestion({ ...all, isInstance: false }), false)
    assert.equal(needsScopeQuestion({ ...all, ruleStopped: true }), false)
    assert.equal(needsScopeQuestion({ ...all, dateChanged: false }), false)
    // 日期與規則一起改:不問,直接套用到整個規則
    assert.equal(needsScopeQuestion({ ...all, ruleChanged: true }), false)
  })
})
