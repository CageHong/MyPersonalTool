// 必須是第一個 import:在 db 連線建立前切到記憶體資料庫
import '../test/setup'
import assert from 'node:assert/strict'
import { before, beforeEach, describe, test } from 'node:test'
import { applyMigrations, db } from '../db'
import { habit, task, taskReminder } from '../db/schema'
import { ValidationError, NotFoundError } from './errors'
import { createHabit, deleteHabit, listHabits, updateHabit } from './habits'
import { createRuleFromTask, getRule, updateRule } from './recurrence'
import { createTask, deleteTask, listTasks, updateTask } from './tasks'
import { createReminder, deleteReminder, listReminders, updateReminder } from './reminders'

// 規格:docs/tasks/decisions.md §6j「提醒」表末「(2026-11-22 改)」的條目

// 2026-09-19 是星期六
const TODAY = '2026-09-19'
const YESTERDAY = '2026-09-18'
const TOMORROW = '2026-09-20'

function at(date: string, time: string): Date {
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  return new Date(year, month - 1, day, hour, minute)
}

const NOW = at(TODAY, '10:00')

function assertRejects(fn: () => unknown, fields: Record<string, string>) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof ValidationError)
    assert.deepEqual(error.fields, fields)
    return true
  })
}

function reminderRows() {
  return db.select().from(taskReminder).all()
}

before(() => {
  assert.equal(process.env.TASKS_DB_PATH, ':memory:')
  applyMigrations(db)
})

beforeEach(() => {
  db.delete(taskReminder).run()
  db.delete(task).run()
  db.delete(habit).run()
})

describe('createReminder / listReminders', () => {
  test('a habit takes daily reminders; several are listed in id order', () => {
    const h = createHabit({ name: '冥想', periodType: 'daily', target: 1 }, TODAY)
    const evening = createReminder({ habitId: h.id }, { kind: 'daily', time: '20:00' }, NOW)
    const morning = createReminder({ habitId: h.id }, { kind: 'daily', time: '09:00' }, NOW)

    assert.equal(evening.habitId, h.id)
    assert.equal(evening.taskId, null)
    assert.equal(evening.ruleId, null)
    assert.equal(evening.kind, 'daily')
    assert.equal(evening.time, '20:00')
    assert.equal(evening.daysBefore, null)
    assert.equal(evening.date, null)
    assert.deepEqual(
      listReminders({ habitId: h.id }).map((r) => r.id),
      [evening.id, morning.id],
    )
  })

  test('a task takes relative and absolute reminders side by side', () => {
    const t = createTask({ title: '繳電費', dueDate: TOMORROW })
    const relative = createReminder({ taskId: t.id }, { kind: 'relative', daysBefore: 1, time: '20:00' }, NOW)
    const absolute = createReminder({ taskId: t.id }, { kind: 'absolute', date: TODAY, time: '18:00' }, NOW)

    assert.equal(relative.daysBefore, 1)
    assert.equal(relative.date, null)
    assert.equal(absolute.date, TODAY)
    assert.equal(absolute.daysBefore, null)
    assert.equal(listReminders({ taskId: t.id }).length, 2)
  })

  test('a task without a due date can still take relative reminders; they wait for a due date', () => {
    // 相對提醒在沒有到期日時保留、不送(送出判斷見 notifications.test.ts);設定本身不拒絕
    const t = createTask({ title: '沒有日期' })
    const r = createReminder({ taskId: t.id }, { kind: 'relative', daysBefore: 0, time: '09:00' }, NOW)
    assert.equal(r.taskId, t.id)
  })

  test('a recurrence rule takes relative reminders only', () => {
    const source = createTask({ title: '倒垃圾', dueDate: TODAY })
    const rule = createRuleFromTask(source.id, { freq: 'daily', interval: 1, startDate: TODAY }, TODAY)

    const r = createReminder({ ruleId: rule.id }, { kind: 'relative', daysBefore: 0, time: '19:00' }, NOW)
    assert.equal(r.ruleId, rule.id)
    assertRejects(
      () => createReminder({ ruleId: rule.id }, { kind: 'absolute', date: TOMORROW, time: '09:00' }, NOW),
      { kind: 'invalid_value' },
    )
  })

  test('rejects a kind that does not fit the owner', () => {
    const h = createHabit({ name: '冥想', periodType: 'daily', target: 1 }, TODAY)
    const t = createTask({ title: '繳電費', dueDate: TOMORROW })

    assertRejects(() => createReminder({ habitId: h.id }, { kind: 'relative', daysBefore: 0, time: '09:00' }, NOW), {
      kind: 'invalid_value',
    })
    assertRejects(() => createReminder({ taskId: t.id }, { kind: 'daily', time: '09:00' }, NOW), {
      kind: 'invalid_value',
    })
    assertRejects(
      () => createReminder({ taskId: t.id }, { kind: 'weekly', time: '09:00' } as never, NOW),
      { kind: 'invalid_value' },
    )
  })

  test('rejects a time that is not HH:MM', () => {
    const h = createHabit({ name: '冥想', periodType: 'daily', target: 1 }, TODAY)
    for (const time of ['9:00', '24:00', '12:60', '']) {
      assertRejects(() => createReminder({ habitId: h.id }, { kind: 'daily', time }, NOW), {
        time: 'invalid_value',
      })
    }
  })

  test('daysBefore is an integer from 0 to 28 on a task, 0 to 6 on a rule', () => {
    // 規則的實例只落地到今天 + 6,更早的提醒碰不到還沒產生的實例
    const t = createTask({ title: '報稅', dueDate: '2026-10-30' })
    createReminder({ taskId: t.id }, { kind: 'relative', daysBefore: 28, time: '09:00' }, NOW)
    for (const daysBefore of [-1, 29, 1.5]) {
      assertRejects(() => createReminder({ taskId: t.id }, { kind: 'relative', daysBefore, time: '09:00' }, NOW), {
        daysBefore: 'invalid_value',
      })
    }

    const source = createTask({ title: '倒垃圾', dueDate: TODAY })
    const rule = createRuleFromTask(source.id, { freq: 'daily', interval: 1, startDate: TODAY }, TODAY)
    createReminder({ ruleId: rule.id }, { kind: 'relative', daysBefore: 6, time: '09:00' }, NOW)
    assertRejects(() => createReminder({ ruleId: rule.id }, { kind: 'relative', daysBefore: 7, time: '09:00' }, NOW), {
      daysBefore: 'invalid_value',
    })
  })

  test('rejects an absolute reminder with a bad date, or one already in the past', () => {
    const t = createTask({ title: '繳電費' })

    assertRejects(() => createReminder({ taskId: t.id }, { kind: 'absolute', date: '2026/09/20', time: '09:00' }, NOW), {
      date: 'invalid_format',
    })
    assertRejects(() => createReminder({ taskId: t.id }, { kind: 'absolute', date: YESTERDAY, time: '23:00' }, NOW), {
      date: 'in_past',
    })
    // 今天、但時刻已過(NOW 是 10:00)
    assertRejects(() => createReminder({ taskId: t.id }, { kind: 'absolute', date: TODAY, time: '09:59' }, NOW), {
      date: 'in_past',
    })
    // 正好是現在這一分鐘:還沒過
    createReminder({ taskId: t.id }, { kind: 'absolute', date: TODAY, time: '10:00' }, NOW)
  })

  test('allows at most 5 reminders per owner', () => {
    const h = createHabit({ name: '喝水', periodType: 'daily', target: 8 }, TODAY)
    for (const time of ['09:00', '11:00', '13:00', '15:00', '17:00']) {
      createReminder({ habitId: h.id }, { kind: 'daily', time }, NOW)
    }
    assertRejects(() => createReminder({ habitId: h.id }, { kind: 'daily', time: '19:00' }, NOW), {
      reminders: 'too_many',
    })
    // 別的項目不受影響
    const other = createHabit({ name: '伸展', periodType: 'daily', target: 1 }, TODAY)
    createReminder({ habitId: other.id }, { kind: 'daily', time: '19:00' }, NOW)
  })

  test('throws NotFoundError for an owner that does not exist', () => {
    assert.throws(
      () => createReminder({ taskId: 999999 }, { kind: 'relative', daysBefore: 0, time: '09:00' }, NOW),
      NotFoundError,
    )
    assert.throws(() => listReminders({ habitId: 999999 }), NotFoundError)
  })
})

describe('updateReminder / deleteReminder', () => {
  test('update replaces the whole setting, keeping the owner', () => {
    const t = createTask({ title: '繳電費', dueDate: TOMORROW })
    const r = createReminder({ taskId: t.id }, { kind: 'relative', daysBefore: 1, time: '20:00' }, NOW)

    const updated = updateReminder(r.id, { kind: 'absolute', date: TOMORROW, time: '08:00' }, NOW)
    assert.equal(updated.id, r.id)
    assert.equal(updated.taskId, t.id)
    assert.equal(updated.kind, 'absolute')
    assert.equal(updated.date, TOMORROW)
    assert.equal(updated.daysBefore, null)
    assert.equal(updated.time, '08:00')
  })

  test('update runs the same checks as create', () => {
    const h = createHabit({ name: '冥想', periodType: 'daily', target: 1 }, TODAY)
    const r = createReminder({ habitId: h.id }, { kind: 'daily', time: '20:00' }, NOW)

    assertRejects(() => updateReminder(r.id, { kind: 'daily', time: '25:00' }, NOW), { time: 'invalid_value' })
    assertRejects(() => updateReminder(r.id, { kind: 'absolute', date: TOMORROW, time: '09:00' }, NOW), {
      kind: 'invalid_value',
    })
    assert.equal(listReminders({ habitId: h.id })[0].time, '20:00')
  })

  test('update and delete throw NotFoundError for a missing reminder', () => {
    assert.throws(() => updateReminder(999999, { kind: 'daily', time: '09:00' }, NOW), NotFoundError)
    assert.throws(() => deleteReminder(999999), NotFoundError)
  })

  test('delete removes just that reminder', () => {
    const h = createHabit({ name: '冥想', periodType: 'daily', target: 1 }, TODAY)
    const a = createReminder({ habitId: h.id }, { kind: 'daily', time: '09:00' }, NOW)
    const b = createReminder({ habitId: h.id }, { kind: 'daily', time: '20:00' }, NOW)

    deleteReminder(a.id)
    assert.deepEqual(
      listReminders({ habitId: h.id }).map((r) => r.id),
      [b.id],
    )
  })

  test('deleting the task or habit deletes its reminders', () => {
    const h = createHabit({ name: '冥想', periodType: 'daily', target: 1 }, TODAY)
    const t = createTask({ title: '繳電費', dueDate: TOMORROW })
    createReminder({ habitId: h.id }, { kind: 'daily', time: '09:00' }, NOW)
    createReminder({ taskId: t.id }, { kind: 'relative', daysBefore: 0, time: '09:00' }, NOW)

    deleteHabit(h.id)
    deleteTask(t.id)
    assert.deepEqual(reminderRows(), [])
  })
})

describe('excludeFromSummary', () => {
  test('defaults to false on tasks and habits', () => {
    assert.equal(createTask({ title: '繳電費' }).excludeFromSummary, false)
    assert.equal(createHabit({ name: '冥想', periodType: 'daily', target: 1 }, TODAY).excludeFromSummary, false)
  })

  test('can be set on create and changed by update', () => {
    const t = createTask({ title: '倒垃圾', excludeFromSummary: true })
    assert.equal(t.excludeFromSummary, true)
    assert.equal(updateTask(t.id, { excludeFromSummary: false }).excludeFromSummary, false)

    const h = createHabit({ name: '冥想', periodType: 'daily', target: 1, excludeFromSummary: true }, TODAY)
    assert.equal(h.excludeFromSummary, true)
    assert.equal(updateHabit(h.id, { excludeFromSummary: false }, TODAY).excludeFromSummary, false)
    assert.equal(listHabits(TODAY)[0].excludeFromSummary, false)
  })

  test('rejects a non-boolean value', () => {
    const t = createTask({ title: '倒垃圾' })
    const h = createHabit({ name: '冥想', periodType: 'daily', target: 1 }, TODAY)

    assertRejects(() => updateTask(t.id, { excludeFromSummary: 'yes' as unknown as boolean }), {
      excludeFromSummary: 'invalid_value',
    })
    assertRejects(() => updateHabit(h.id, { excludeFromSummary: 1 as unknown as boolean }, TODAY), {
      excludeFromSummary: 'invalid_value',
    })
  })

  test('a rule takes it from the source task and passes it to the instances it generates', () => {
    const source = createTask({ title: '倒垃圾', dueDate: TODAY, excludeFromSummary: true })
    const rule = createRuleFromTask(source.id, { freq: 'daily', interval: 1, startDate: TODAY }, TODAY)

    assert.equal(rule.excludeFromSummary, true)
    const instances = listTasks({ today: TODAY }).filter((row) => row.recurrenceRuleId === rule.id)
    assert.ok(instances.length > 1)
    assert.ok(instances.every((row) => row.excludeFromSummary))
  })

  test('changing it on a rule works like the other template fields: instances from tomorrow follow', () => {
    // 與 title、priority 同:範本改了,明天起未完成的實例重新產生;今天的實例屬於舊規則
    const source = createTask({ title: '倒垃圾', dueDate: TODAY })
    const rule = createRuleFromTask(source.id, { freq: 'daily', interval: 1, startDate: TODAY }, TODAY)

    updateRule(rule.id, { excludeFromSummary: true }, TODAY)
    assert.equal(getRule(rule.id).excludeFromSummary, true)

    const instances = listTasks({ today: TODAY }).filter((row) => row.recurrenceRuleId === rule.id)
    assert.equal(instances.find((row) => row.dueDate === TODAY)?.excludeFromSummary, false)
    assert.equal(instances.find((row) => row.dueDate === TOMORROW)?.excludeFromSummary, true)
  })
})
