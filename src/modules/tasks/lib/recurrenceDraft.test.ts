import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { RecurrenceRuleView } from './recurrence'
import {
  classifyRule,
  initialDraft,
  labelAnchor,
  presetLabel,
  presetSpec,
  recurrenceChanges,
  resolveSpec,
  WEEKDAYS_MASK,
  type RecurrenceDraft,
} from './recurrenceDraft'

// 2026-09-16 週三、09-17 週四、09-18 週五
const WED = '2026-09-16'
const THU = '2026-09-17'
const FRI = '2026-09-18'
const MONDAY = 1 << 0
const WEDNESDAY = 1 << 2
const THURSDAY = 1 << 3

function rule(overrides: Partial<RecurrenceRuleView> = {}): RecurrenceRuleView {
  return {
    id: 1,
    freq: 'daily',
    interval: 1,
    weekdays: null,
    startDate: WED,
    until: null,
    endedAt: null,
    ...overrides,
  }
}

function draft(overrides: Partial<RecurrenceDraft> = {}): RecurrenceDraft {
  return {
    repeat: 'none',
    custom: { freq: 'weekly', intervalText: '1', weekdays: MONDAY },
    until: null,
    ...overrides,
  }
}

function specOf(result: ReturnType<typeof presetSpec>) {
  assert.ok('spec' in result)
  return result.spec
}

describe('presetSpec', () => {
  test('weekly follows the date in the menu', () => {
    assert.equal(specOf(presetSpec(draft({ repeat: 'weekly' }), WED))?.weekdays, WEDNESDAY)
    assert.equal(specOf(presetSpec(draft({ repeat: 'weekly' }), THU))?.weekdays, THURSDAY)
  })

  test('every weekday is weekly Monday to Friday', () => {
    assert.deepEqual(specOf(presetSpec(draft({ repeat: 'weekdays' }), FRI)), {
      freq: 'weekly',
      interval: 1,
      weekdays: WEEKDAYS_MASK,
      startDate: FRI,
      until: null,
    })
  })

  test('monthly and yearly take their day from the anchor', () => {
    assert.deepEqual(specOf(presetSpec(draft({ repeat: 'monthly' }), FRI)), {
      freq: 'monthly',
      interval: 1,
      weekdays: null,
      startDate: FRI,
      until: null,
    })
    assert.equal(specOf(presetSpec(draft({ repeat: 'yearly' }), FRI))?.startDate, FRI)
  })

  test('none is null; until is carried', () => {
    assert.equal(specOf(presetSpec(draft(), FRI)), null)
    assert.equal(specOf(presetSpec(draft({ repeat: 'daily', until: '2026-09-30' }), FRI))?.until, '2026-09-30')
  })

  test('custom with an invalid interval returns errors', () => {
    const result = presetSpec(
      draft({ repeat: 'custom', custom: { freq: 'daily', intervalText: '0', weekdays: 0 } }),
      FRI,
    )

    assert.deepEqual(result, { errors: { interval: '間隔要是 1 到 99 的整數' } })
  })

  test('custom weekly without days returns errors', () => {
    const result = presetSpec(
      draft({ repeat: 'custom', custom: { freq: 'weekly', intervalText: '2', weekdays: 0 } }),
      FRI,
    )

    assert.deepEqual(result, { errors: { weekdays: '至少選一天' } })
  })
})

describe('classifyRule', () => {
  test('recognizes each preset', () => {
    assert.equal(classifyRule(rule()), 'daily')
    assert.equal(classifyRule(rule({ freq: 'weekly', weekdays: WEDNESDAY })), 'weekly')
    assert.equal(classifyRule(rule({ freq: 'weekly', weekdays: WEEKDAYS_MASK })), 'weekdays')
    assert.equal(classifyRule(rule({ freq: 'monthly' })), 'monthly')
    assert.equal(classifyRule(rule({ freq: 'yearly' })), 'yearly')
  })

  test('other weekday sets and intervals are custom', () => {
    assert.equal(classifyRule(rule({ freq: 'weekly', weekdays: MONDAY | THURSDAY })), 'custom')
    assert.equal(classifyRule(rule({ interval: 2 })), 'custom')
  })

  test('uses the rule anchor: a Wednesday rule opened from a Thursday instance stays weekly', () => {
    const wednesday = rule({ freq: 'weekly', weekdays: WEDNESDAY, startDate: WED })

    assert.equal(initialDraft(wednesday, THU).repeat, 'weekly')
    // 選中那一項的括號用規則的錨點,其他項用當下的日期
    assert.equal(presetLabel('weekly', labelAnchor('weekly', 'weekly', wednesday, THU)), '每週（週三）')
    assert.equal(presetLabel('monthly', labelAnchor('monthly', 'weekly', wednesday, THU)), '每月（17 日）')
    // 改選別項之後,原本那一項也改用當下的日期
    assert.equal(presetLabel('weekly', labelAnchor('weekly', 'daily', wednesday, THU)), '每週（週四）')
  })

  test('without a rule the labels use the date in the menu', () => {
    assert.equal(presetLabel('weekly', labelAnchor('weekly', 'weekly', null, THU)), '每週（週四）')
    assert.equal(presetLabel('yearly', labelAnchor('yearly', 'none', null, THU)), '每年（9 月 17 日）')
  })
})

describe('recurrenceChanges', () => {
  test('no rule + a choice → create', () => {
    const spec = specOf(presetSpec(draft({ repeat: 'daily' }), FRI))

    assert.deepEqual(recurrenceChanges(null, spec), { kind: 'create', spec })
    assert.equal(recurrenceChanges(null, null), null)
  })

  test('a stopped rule + a choice → create a new rule', () => {
    const stopped = rule({ endedAt: 1 })
    const spec = specOf(presetSpec(draft({ repeat: 'weekly' }), FRI))

    assert.deepEqual(recurrenceChanges(stopped, spec), { kind: 'create', spec })
    assert.equal(recurrenceChanges(stopped, null), null)
  })

  test('active rule + none → stop', () => {
    assert.deepEqual(recurrenceChanges(rule(), null), { kind: 'stop', ruleId: 1 })
  })

  test('changing the cadence sends the anchor from the menu', () => {
    const current = rule({ freq: 'weekly', weekdays: WEDNESDAY })
    const result = resolveSpec(draft({ repeat: 'monthly' }), THU, current)

    assert.deepEqual(recurrenceChanges(current, specOf(result)), {
      kind: 'update',
      ruleId: 1,
      changes: { freq: 'monthly', interval: 1, weekdays: null, startDate: THU },
    })
  })

  test('changing only until keeps the anchor', () => {
    const current = rule({ freq: 'weekly', weekdays: WEDNESDAY })
    const result = resolveSpec(draft({ repeat: 'weekly', until: '2026-10-31' }), THU, current)

    assert.deepEqual(recurrenceChanges(current, specOf(result)), {
      kind: 'update',
      ruleId: 1,
      changes: { until: '2026-10-31' },
    })
  })

  test('reopening an unchanged rule from a moved instance sends nothing', () => {
    const current = rule({ freq: 'weekly', weekdays: WEDNESDAY })

    const result = resolveSpec(initialDraft(current, THU), THU, current)

    assert.equal(recurrenceChanges(current, specOf(result)), null)
  })

  test('an unchanged custom rule sends nothing', () => {
    const current = rule({ freq: 'weekly', interval: 2, weekdays: MONDAY | THURSDAY })

    const result = resolveSpec(initialDraft(current, FRI), FRI, current)

    assert.equal(recurrenceChanges(current, specOf(result)), null)
  })
})
