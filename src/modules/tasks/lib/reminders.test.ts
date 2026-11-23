import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { fieldMessage, reminderMessage } from './errors'
import { areSummaryTimesInOrder, formatReminderLabel, type ReminderItem } from './reminders'

function makeReminder(overrides: Partial<ReminderItem>): ReminderItem {
  return {
    id: 1,
    taskId: null,
    ruleId: null,
    habitId: null,
    kind: 'daily',
    daysBefore: null,
    date: null,
    time: '09:00',
    ...overrides,
  }
}

describe('areSummaryTimesInOrder', () => {
  test('returns true only when morning < afternoon < evening', () => {
    assert.equal(
      areSummaryTimesInOrder({
        morning: { time: '08:00', enabled: true },
        afternoon: { time: '15:00', enabled: true },
        evening: { time: '21:00', enabled: true },
      }),
      true,
    )
    assert.equal(
      areSummaryTimesInOrder({
        morning: { time: '15:00', enabled: true },
        afternoon: { time: '15:00', enabled: true },
        evening: { time: '21:00', enabled: true },
      }),
      false,
    )
    assert.equal(
      areSummaryTimesInOrder({
        morning: { time: '16:00', enabled: true },
        afternoon: { time: '15:00', enabled: true },
        evening: { time: '21:00', enabled: true },
      }),
      false,
    )
  })
})

describe('formatReminderLabel', () => {
  test('formats daily, relative, and absolute reminders', () => {
    assert.equal(formatReminderLabel(makeReminder({ kind: 'daily', time: '08:30' })), '每天 08:30')
    assert.equal(
      formatReminderLabel(makeReminder({ kind: 'relative', daysBefore: 0, time: '09:00' })),
      '當天 09:00',
    )
    assert.equal(
      formatReminderLabel(makeReminder({ kind: 'relative', daysBefore: 3, time: '20:00' })),
      '提前 3 天 20:00',
    )
    assert.equal(
      formatReminderLabel(makeReminder({ kind: 'absolute', date: '2026-10-01', time: '14:00' })),
      '2026-10-01 14:00',
    )
  })
})

describe('reminder error messages', () => {
  test('translates reminder and notification field errors to Traditional Chinese', () => {
    assert.ok(fieldMessage('times', 'out_of_order').includes('順序'))
    assert.ok(fieldMessage('date', 'in_past').includes('時間'))
    assert.ok(fieldMessage('reminders', 'too_many').includes('5'))
    assert.ok(fieldMessage('daysBefore', 'invalid_value').includes('天數'))
    assert.ok(fieldMessage('kind', 'invalid_value').includes('類型'))
    assert.ok(fieldMessage('time', 'invalid_value').includes('時刻'))
    assert.ok(reminderMessage('NOT_FOUND').includes('提醒'))
  })
})
