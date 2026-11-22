// 必須是第一個 import:在 db 連線建立前切到記憶體資料庫
import '../test/setup'
import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { before, beforeEach, describe, test } from 'node:test'
import { applyMigrations, db } from '../db'
import { habit, task, taskNotificationSent, taskNotificationSetting, taskRecurrenceRule, taskReminder } from '../db/schema'
import { addLog, createHabit, pauseHabit, removeLog } from './habits'
import { createRuleFromTask, updateRule } from './recurrence'
import { createReminder, updateReminder, type Reminder } from './reminders'
import { createTask, listTasks, updateTask } from './tasks'
import { ValidationError } from './errors'
import {
  dueTaskNotifications,
  getNotificationSettings,
  markTaskNotificationsSent,
  saveNotificationSettings,
  upcomingTaskNotifications,
  type NotificationSettings,
} from './notifications'

// 2026-09-19 是星期六;週從星期一開始,所以本週是 09-14 到 09-20
const TODAY = '2026-09-19'
const YESTERDAY = '2026-09-18'
const TOMORROW = '2026-09-20'

// 本地時刻:runner 交進來的是 Date,工具用本地的日期與時刻判斷
function at(date: string, time: string): Date {
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  return new Date(year, month - 1, day, hour, minute)
}

function keysAt(date: string, time: string): string[] {
  return dueTaskNotifications(at(date, time)).map((item) => item.key)
}

function messageOf(date: string, time: string, key: string) {
  const found = dueTaskNotifications(at(date, time)).find((item) => item.key === key)
  assert.ok(found, `expected ${key} to be due`)
  return found.message
}

function sentRows() {
  return db
    .select({ key: taskNotificationSent.key, date: taskNotificationSent.date })
    .from(taskNotificationSent)
    .all()
    .sort((a, b) => (a.key + a.date < b.key + b.date ? -1 : 1))
}

const DEFAULTS: NotificationSettings = {
  morning: { time: '08:00', enabled: true },
  afternoon: { time: '15:00', enabled: true },
  evening: { time: '21:00', enabled: true },
}

function settingsWith(patch: Partial<NotificationSettings>): NotificationSettings {
  return { ...DEFAULTS, ...patch }
}

function assertRejects(fn: () => unknown, fields: Record<string, string>) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof ValidationError)
    assert.deepEqual(error.fields, fields)
    return true
  })
}

before(() => {
  // 保險:萬一 test/setup 沒先載入,不在真的資料庫上跑 migration 與寫入
  assert.equal(process.env.TASKS_DB_PATH, ':memory:')
  applyMigrations(db)
})

beforeEach(() => {
  // 每個測試從空的資料開始;checklist、log、設定歷史、停止區間由外鍵 cascade 一起刪
  db.delete(taskNotificationSent).run()
  db.delete(taskReminder).run()
  db.delete(taskNotificationSetting).run()
  db.delete(task).run()
  db.delete(habit).run()
})

describe('notification settings', () => {
  test('defaults to 08:00 / 15:00 / 21:00, all enabled, when nothing is saved', () => {
    assert.deepEqual(getNotificationSettings(), DEFAULTS)
  })

  test('saves the whole set and reads it back', () => {
    const input = settingsWith({
      morning: { time: '07:30', enabled: true },
      afternoon: { time: '14:00', enabled: false },
    })
    assert.deepEqual(saveNotificationSettings(input), input)
    assert.deepEqual(getNotificationSettings(), input)

    // 再存一次是整份替換,不是追加
    assert.deepEqual(saveNotificationSettings(DEFAULTS), DEFAULTS)
    assert.deepEqual(getNotificationSettings(), DEFAULTS)
  })

  test('rejects times that are not HH:MM', () => {
    for (const time of ['8:00', '24:00', '12:60', '0800', '', 'noon']) {
      assertRejects(() => saveNotificationSettings(settingsWith({ morning: { time, enabled: true } })), {
        morning: 'invalid_value',
      })
    }
  })

  test('rejects a non-boolean enabled flag', () => {
    assertRejects(
      () =>
        saveNotificationSettings(
          settingsWith({ evening: { time: '21:00', enabled: 'yes' as unknown as boolean } }),
        ),
      { evening: 'invalid_value' },
    )
  })

  test('rejects times that are not strictly morning < afternoon < evening', () => {
    assertRejects(
      () => saveNotificationSettings(settingsWith({ afternoon: { time: '07:00', enabled: true } })),
      { times: 'out_of_order' },
    )
    assertRejects(
      () => saveNotificationSettings(settingsWith({ evening: { time: '15:00', enabled: true } })),
      { times: 'out_of_order' },
    )
  })

  test('a disabled summary still takes part in the order check', () => {
    assertRejects(
      () => saveNotificationSettings(settingsWith({ afternoon: { time: '22:00', enabled: false } })),
      { times: 'out_of_order' },
    )
  })

  test('a rejected save leaves the stored settings unchanged', () => {
    assert.throws(() => saveNotificationSettings(settingsWith({ morning: { time: '16:00', enabled: true } })))
    assert.deepEqual(getNotificationSettings(), DEFAULTS)
  })
})

describe('morning summary', () => {
  test('is not due before its time', () => {
    createTask({ title: '寫週報', dueDate: TODAY })
    assert.deepEqual(keysAt(TODAY, '07:59'), [])
  })

  test('lists tasks due today or overdue, and progress of active habits with a target', () => {
    createTask({ title: '繳電費', dueDate: YESTERDAY })
    createTask({ title: '寫週報', dueDate: TODAY })
    createTask({ title: '明天的事', dueDate: TOMORROW })
    createTask({ title: '沒有日期' })
    const done = createTask({ title: '已經做完', dueDate: TODAY })
    updateTask(done.id, { done: true })

    const meditation = createHabit({ name: '冥想', periodType: 'weekly', target: 6 }, '2026-09-14')
    addLog(meditation.id, '2026-09-15', TODAY)
    createHabit({ name: '記體重', periodType: 'daily', target: null }, TODAY)
    const paused = createHabit({ name: '跑步', periodType: 'weekly', target: 3 }, TODAY)
    pauseHabit(paused.id, TODAY)

    assert.deepEqual(messageOf(TODAY, '08:00', `summary:morning@${TODAY}`), {
      title: '早上總覽',
      body: ['任務', '- 繳電費(逾期)', '- 寫週報', '習慣', '- 冥想 1/6'].join('\n'),
    })
  })

  test('leaves out a group that has nothing in it', () => {
    createTask({ title: '寫週報', dueDate: TODAY })

    assert.deepEqual(messageOf(TODAY, '08:00', `summary:morning@${TODAY}`), {
      title: '早上總覽',
      body: ['任務', '- 寫週報'].join('\n'),
    })
  })

  test('content is computed when it is sent, not at the scheduled time', () => {
    const first = createTask({ title: '寫週報', dueDate: TODAY })
    createTask({ title: '繳電費', dueDate: TODAY })
    updateTask(first.id, { done: true })

    assert.deepEqual(messageOf(TODAY, '10:30', `summary:morning@${TODAY}`).body, ['任務', '- 繳電費'].join('\n'))
  })

  test('is due only once a day once marked sent, and again the next day', () => {
    createTask({ title: '繳電費', dueDate: YESTERDAY })

    assert.deepEqual(keysAt(TODAY, '08:00'), [`summary:morning@${TODAY}`])
    markTaskNotificationsSent([`summary:morning@${TODAY}`])
    assert.deepEqual(keysAt(TODAY, '08:15'), [])
    assert.deepEqual(keysAt(TOMORROW, '08:00'), [`summary:morning@${TOMORROW}`])
  })

  test('is caught up until the afternoon summary takes over', () => {
    createTask({ title: '寫週報', dueDate: TODAY })

    assert.ok(keysAt(TODAY, '14:59').includes(`summary:morning@${TODAY}`))
    assert.ok(!keysAt(TODAY, '15:00').includes(`summary:morning@${TODAY}`))
  })

  test('with the afternoon summary off, is caught up until the evening summary', () => {
    saveNotificationSettings(settingsWith({ afternoon: { time: '15:00', enabled: false } }))
    createTask({ title: '寫週報', dueDate: TODAY })

    assert.deepEqual(keysAt(TODAY, '20:59'), [`summary:morning@${TODAY}`])
    assert.ok(!keysAt(TODAY, '21:00').includes(`summary:morning@${TODAY}`))
  })

  test('with both later summaries off, is caught up until the end of the day', () => {
    saveNotificationSettings(
      settingsWith({
        afternoon: { time: '15:00', enabled: false },
        evening: { time: '21:00', enabled: false },
      }),
    )
    createTask({ title: '寫週報', dueDate: TODAY })

    assert.deepEqual(keysAt(TODAY, '23:59'), [`summary:morning@${TODAY}`])
  })

  test('follows a changed time', () => {
    saveNotificationSettings(settingsWith({ morning: { time: '09:30', enabled: true } }))
    createTask({ title: '寫週報', dueDate: TODAY })

    assert.deepEqual(keysAt(TODAY, '09:29'), [])
    assert.deepEqual(keysAt(TODAY, '09:30'), [`summary:morning@${TODAY}`])
  })

  test('is never due when disabled', () => {
    saveNotificationSettings(settingsWith({ morning: { time: '08:00', enabled: false } }))
    createTask({ title: '寫週報', dueDate: TODAY })

    assert.deepEqual(keysAt(TODAY, '08:00'), [])
    assert.deepEqual(sentRows(), [])
  })

  test('with nothing to say, is not returned but recorded as sent', () => {
    assert.deepEqual(keysAt(TODAY, '08:00'), [])
    assert.deepEqual(sentRows(), [{ key: 'summary:morning', date: TODAY }])

    // 同一天不再判斷:之後才出現的任務不會讓它晚一點送出
    createTask({ title: '臨時的事', dueDate: TODAY })
    assert.deepEqual(keysAt(TODAY, '09:00'), [])
  })
})

describe('afternoon summary', () => {
  test('splits active habits with a target into done and not done', () => {
    createTask({ title: '寫週報', dueDate: TODAY })
    const stretch = createHabit({ name: '伸展', periodType: 'daily', target: 1 }, TODAY)
    addLog(stretch.id, TODAY, TODAY)
    createHabit({ name: '冥想', periodType: 'weekly', target: 6 }, '2026-09-14')
    createHabit({ name: '記體重', periodType: 'daily', target: null }, TODAY)

    assert.deepEqual(messageOf(TODAY, '15:00', `summary:afternoon@${TODAY}`), {
      title: '習慣進度',
      body: ['已完成', '- 伸展 1/1', '未完成', '- 冥想 0/6'].join('\n'),
    })
  })

  test('mentions no tasks, so with only tasks it is recorded as sent without being returned', () => {
    createTask({ title: '寫週報', dueDate: TODAY })

    assert.ok(!keysAt(TODAY, '15:00').includes(`summary:afternoon@${TODAY}`))
    assert.ok(sentRows().some((row) => row.key === 'summary:afternoon' && row.date === TODAY))
  })

  test('is caught up until the evening summary', () => {
    createHabit({ name: '冥想', periodType: 'weekly', target: 6 }, TODAY)

    assert.ok(keysAt(TODAY, '20:59').includes(`summary:afternoon@${TODAY}`))
    assert.ok(!keysAt(TODAY, '21:00').includes(`summary:afternoon@${TODAY}`))
  })
})

describe('evening summary', () => {
  test('lists unfinished tasks and habits whose period ends today without reaching the target', () => {
    // TOMORROW(09-20)是星期日,本週的最後一天
    createTask({ title: '繳電費', dueDate: TODAY })
    createTask({ title: '寫週報', dueDate: TOMORROW })
    const weekly = createHabit({ name: '冥想', periodType: 'weekly', target: 6 }, '2026-09-14')
    addLog(weekly.id, '2026-09-16', TOMORROW)
    createHabit({ name: '讀書', periodType: 'daily', target: 1 }, TOMORROW)
    const met = createHabit({ name: '伸展', periodType: 'daily', target: 1 }, TOMORROW)
    addLog(met.id, TOMORROW, TOMORROW)
    // 月底不是今天:明天之後還能補,不催
    createHabit({ name: '捐血', periodType: 'monthly', target: 1 }, TOMORROW)

    assert.deepEqual(messageOf(TOMORROW, '21:00', `summary:evening@${TOMORROW}`), {
      title: '晚上收尾',
      body: ['任務', '- 繳電費(逾期)', '- 寫週報', '習慣', '- 冥想 1/6', '- 讀書 0/1'].join('\n'),
    })
  })

  test('leaves out a weekly habit when the week is not over', () => {
    createHabit({ name: '冥想', periodType: 'weekly', target: 6 }, TODAY)

    assert.ok(!keysAt(TODAY, '21:00').includes(`summary:evening@${TODAY}`))
  })

  test('is caught up until the end of the day, then gone', () => {
    createTask({ title: '寫週報', dueDate: TODAY })

    assert.ok(keysAt(TODAY, '23:59').includes(`summary:evening@${TODAY}`))
    assert.ok(!keysAt(TOMORROW, '00:15').some((key) => key.startsWith('summary:evening')))
  })
})


// ---- 以下規格:decisions §6j 表末「(2026-11-22 改)」的條目 ----

// 建立提醒時的「現在」:早於所有測試用的時刻,絕對提醒不會被當成過去
const SETUP_NOW = at(YESTERDAY, '00:00')

function habitReminder(habitId: number, time: string): Reminder {
  return createReminder({ habitId }, { kind: 'daily', time }, SETUP_NOW)
}

function relativeReminder(taskId: number, daysBefore: number, time: string): Reminder {
  return createReminder({ taskId }, { kind: 'relative', daysBefore, time }, SETUP_NOW)
}

function absoluteReminder(taskId: number, date: string, time: string): Reminder {
  return createReminder({ taskId }, { kind: 'absolute', date, time }, SETUP_NOW)
}

// 已送標記的 key 帶提醒的時刻:送出後把時刻改晚,當天會再送一次
function habitKey(reminder: Reminder, date: string): string {
  return `reminder:${reminder.id}:${reminder.time}@${date}`
}

// 任務的 key 另外帶任務 id:同一條規則的兩個實例可能被改成同一天到期
function taskKey(reminder: Reminder, taskId: number, date: string): string {
  return `reminder:${reminder.id}:${taskId}:${reminder.time}@${date}`
}

function allSummariesOff() {
  saveNotificationSettings(
    settingsWith({
      morning: { time: '08:00', enabled: false },
      afternoon: { time: '15:00', enabled: false },
      evening: { time: '21:00', enabled: false },
    }),
  )
}

describe('excludeFromSummary', () => {
  test('a task marked so is left out of the morning and evening summaries', () => {
    createTask({ title: '寫週報', dueDate: TODAY })
    createTask({ title: '倒垃圾', dueDate: TODAY, excludeFromSummary: true })

    assert.deepEqual(messageOf(TODAY, '08:00', `summary:morning@${TODAY}`).body, ['任務', '- 寫週報'].join('\n'))
    assert.deepEqual(messageOf(TODAY, '21:00', `summary:evening@${TODAY}`).body, ['任務', '- 寫週報'].join('\n'))
  })

  test('a habit marked so is left out of all three summaries', () => {
    // TOMORROW 是週日:晚上那則會列本週沒達標的習慣
    createHabit({ name: '冥想', periodType: 'weekly', target: 6 }, '2026-09-14')
    createHabit({ name: '跑步', periodType: 'weekly', target: 3, excludeFromSummary: true }, '2026-09-14')

    assert.deepEqual(messageOf(TOMORROW, '08:00', `summary:morning@${TOMORROW}`).body, ['習慣', '- 冥想 0/6'].join('\n'))
    assert.deepEqual(
      messageOf(TOMORROW, '15:00', `summary:afternoon@${TOMORROW}`).body,
      ['未完成', '- 冥想 0/6'].join('\n'),
    )
    assert.deepEqual(messageOf(TOMORROW, '21:00', `summary:evening@${TOMORROW}`).body, ['習慣', '- 冥想 0/6'].join('\n'))
  })

  test('when everything is marked so, the summary has nothing to say and is recorded as sent', () => {
    createTask({ title: '倒垃圾', dueDate: TODAY, excludeFromSummary: true })

    assert.deepEqual(keysAt(TODAY, '08:00'), [])
    assert.ok(sentRows().some((row) => row.key === 'summary:morning' && row.date === TODAY))
  })

  test('does not affect individual reminders', () => {
    allSummariesOff()
    const t = createTask({ title: '倒垃圾', dueDate: TODAY, excludeFromSummary: true })
    const h = createHabit({ name: '跑步', periodType: 'daily', target: 1, excludeFromSummary: true }, TODAY)
    const tr = relativeReminder(t.id, 0, '19:00')
    const hr = habitReminder(h.id, '19:00')

    assert.deepEqual(keysAt(TODAY, '19:00').sort(), [habitKey(hr, TODAY), taskKey(tr, t.id, TODAY)].sort())
  })
})

// 卡 4(notify-reminders-ui):重複任務的實例看規則上的設定,不看實例自己的(decisions §6j「(2026-11-22 補)」)
describe('excludeFromSummary on recurring tasks follows the rule', () => {
  test('marking the rule takes effect today, though today\'s instance keeps its own value', () => {
    const source = createTask({ title: '倒垃圾', dueDate: TODAY })
    const rule = createRuleFromTask(source.id, { freq: 'daily', interval: 1, startDate: TODAY }, TODAY)
    createTask({ title: '寫週報', dueDate: TODAY })
    updateRule(rule.id, { excludeFromSummary: true }, TODAY)
    const todayInstance = listTasks({ today: TODAY }).find(
      (row) => row.recurrenceRuleId === rule.id && row.dueDate === TODAY,
    )
    assert.equal(todayInstance?.excludeFromSummary, false)

    assert.deepEqual(messageOf(TODAY, '08:00', `summary:morning@${TODAY}`).body, ['任務', '- 寫週報'].join('\n'))
    assert.deepEqual(messageOf(TODAY, '21:00', `summary:evening@${TODAY}`).body, ['任務', '- 寫週報'].join('\n'))
  })

  test('an instance marked on its own is still listed while the rule is not marked', () => {
    const source = createTask({ title: '倒垃圾', dueDate: TODAY })
    createRuleFromTask(source.id, { freq: 'daily', interval: 1, startDate: TODAY }, TODAY)
    updateTask(source.id, { excludeFromSummary: true })

    assert.deepEqual(messageOf(TODAY, '08:00', `summary:morning@${TODAY}`).body, ['任務', '- 倒垃圾'].join('\n'))
  })

  test('the high priority group follows the rule too', () => {
    const source = createTask({ title: '整理收據', dueDate: TOMORROW, priority: 5 })
    const rule = createRuleFromTask(source.id, { freq: 'daily', interval: 7, startDate: TOMORROW }, TODAY)
    createTask({ title: '寫週報', dueDate: TODAY })
    assert.ok(messageOf(TODAY, '08:00', `summary:morning@${TODAY}`).body.includes('整理收據'))

    db.delete(taskNotificationSent).run()
    // 直接改規則的欄位,不經過 updateRule:驗的是摘要讀規則,不是實例被就地更新
    db.update(taskRecurrenceRule).set({ excludeFromSummary: true }).where(eq(taskRecurrenceRule.id, rule.id)).run()
    assert.ok(!messageOf(TODAY, '08:00', `summary:morning@${TODAY}`).body.includes('整理收據'))
  })
})

describe('morning summary: high priority group', () => {
  test('lists unfinished high-priority tasks not already due today or overdue, between tasks and habits', () => {
    createTask({ title: '寫週報', dueDate: TODAY, priority: 5 })
    createTask({ title: '寫論文', priority: 5 })
    createTask({ title: '訂機票', dueDate: '2026-09-25', priority: 5 })
    createTask({ title: '整理照片', priority: 3 })
    createTask({ title: '不想看到', priority: 5, excludeFromSummary: true })
    const done = createTask({ title: '已經做完', priority: 5 })
    updateTask(done.id, { done: true })
    createHabit({ name: '冥想', periodType: 'daily', target: 1 }, TODAY)

    assert.deepEqual(messageOf(TODAY, '08:00', `summary:morning@${TODAY}`).body, [
      '任務',
      '- 寫週報',
      '高優先',
      '- 寫論文',
      '- 訂機票',
      '習慣',
      '- 冥想 0/1',
    ].join('\n'))
  })

  test('alone is enough for the morning summary to be sent', () => {
    createTask({ title: '寫論文', priority: 5 })

    assert.deepEqual(messageOf(TODAY, '08:00', `summary:morning@${TODAY}`).body, ['高優先', '- 寫論文'].join('\n'))
  })

  test('a recurring high-priority task appears once, as its earliest unfinished instance', () => {
    const source = createTask({ title: '健身', dueDate: TOMORROW, priority: 5 })
    createRuleFromTask(source.id, { freq: 'daily', interval: 1, startDate: TOMORROW }, TODAY)

    assert.deepEqual(messageOf(TODAY, '08:00', `summary:morning@${TODAY}`).body, ['高優先', '- 健身'].join('\n'))
  })

  test('is not in the afternoon or evening summaries', () => {
    createTask({ title: '寫論文', priority: 5 })

    assert.ok(!keysAt(TODAY, '15:00').includes(`summary:afternoon@${TODAY}`))
    assert.ok(!keysAt(TODAY, '21:00').includes(`summary:evening@${TODAY}`))
  })
})

describe('habit reminders', () => {
  test('are due from the reminder time while the habit has not reached its target', () => {
    const h = createHabit({ name: '冥想', periodType: 'weekly', target: 6 }, '2026-09-14')
    addLog(h.id, '2026-09-15', TODAY)
    const r = habitReminder(h.id, '19:00')

    assert.ok(!keysAt(TODAY, '18:59').includes(habitKey(r, TODAY)))
    assert.deepEqual(messageOf(TODAY, '19:00', habitKey(r, TODAY)), { title: '習慣提醒', body: '冥想 1/6' })
  })

  test('each of several reminders on one habit is sent at its own time', () => {
    allSummariesOff()
    const h = createHabit({ name: '喝水', periodType: 'daily', target: 8 }, TODAY)
    const morning = habitReminder(h.id, '09:00')
    const afternoon = habitReminder(h.id, '14:00')

    assert.deepEqual(keysAt(TODAY, '09:00'), [habitKey(morning, TODAY)])
    markTaskNotificationsSent([habitKey(morning, TODAY)])
    assert.deepEqual(keysAt(TODAY, '13:59'), [])
    assert.deepEqual(keysAt(TODAY, '14:00'), [habitKey(afternoon, TODAY)])
  })

  test('are caught up for the rest of the day, then gone', () => {
    const h = createHabit({ name: '冥想', periodType: 'daily', target: 1 }, TODAY)
    const r = habitReminder(h.id, '07:00')

    assert.ok(keysAt(TODAY, '23:59').includes(habitKey(r, TODAY)))
    assert.ok(keysAt(TOMORROW, '06:59').every((key) => !key.startsWith(`reminder:${r.id}:`)))
  })

  test('are not sent when the target is already met, but recorded as sent for the day', () => {
    const h = createHabit({ name: '伸展', periodType: 'daily', target: 1 }, TODAY)
    addLog(h.id, TODAY, TODAY)
    const r = habitReminder(h.id, '19:00')

    assert.ok(!keysAt(TODAY, '19:00').includes(habitKey(r, TODAY)))
    assert.ok(sentRows().some((row) => row.key === `reminder:${r.id}:19:00` && row.date === TODAY))

    // 撤銷紀錄後,當天晚一點也不會突然收到
    removeLog(h.id, TODAY)
    assert.ok(!keysAt(TODAY, '20:00').includes(habitKey(r, TODAY)))
  })

  test('are not due for a paused habit', () => {
    const h = createHabit({ name: '跑步', periodType: 'weekly', target: 3 }, TODAY)
    const r = habitReminder(h.id, '19:00')
    pauseHabit(h.id, TODAY)

    assert.ok(!keysAt(TODAY, '19:00').includes(habitKey(r, TODAY)))
  })

  test('for a habit without a target, are always sent at the time, with just the name', () => {
    const h = createHabit({ name: '記體重', periodType: 'daily', target: null }, TODAY)
    addLog(h.id, TODAY, TODAY)
    const r = habitReminder(h.id, '07:00')

    assert.deepEqual(messageOf(TODAY, '07:00', habitKey(r, TODAY)), { title: '習慣提醒', body: '記體重' })
  })

  test('moved to a later time after being sent, are due again at the new time', () => {
    allSummariesOff()
    const h = createHabit({ name: '冥想', periodType: 'daily', target: 1 }, TODAY)
    const r = habitReminder(h.id, '09:00')
    markTaskNotificationsSent([habitKey(r, TODAY)])

    const moved = updateReminder(r.id, { kind: 'daily', time: '20:00' }, at(TODAY, '10:00'))
    assert.deepEqual(keysAt(TODAY, '19:59'), [])
    assert.deepEqual(keysAt(TODAY, '20:00'), [habitKey(moved, TODAY)])
  })
})

describe('task reminders', () => {
  test('a relative reminder is due on the day before the due date by daysBefore, from its time', () => {
    allSummariesOff()
    const t = createTask({ title: '繳電費', dueDate: TOMORROW })
    const r = relativeReminder(t.id, 1, '20:00')

    assert.deepEqual(keysAt(TODAY, '19:59'), [])
    assert.deepEqual(messageOf(TODAY, '20:00', taskKey(r, t.id, TODAY)), {
      title: '任務提醒',
      body: '繳電費(明天到期)',
    })
  })

  test('the body says how far the due date is', () => {
    allSummariesOff()
    const today = createTask({ title: '寫週報', dueDate: TODAY })
    const later = createTask({ title: '報稅', dueDate: '2026-09-22' })
    const noDate = createTask({ title: '整理照片' })
    const overdue = createTask({ title: '繳電費', dueDate: YESTERDAY })
    const r1 = relativeReminder(today.id, 0, '09:00')
    const r2 = relativeReminder(later.id, 3, '09:00')
    const r3 = absoluteReminder(noDate.id, TODAY, '09:00')
    const r4 = absoluteReminder(overdue.id, TODAY, '09:00')

    assert.equal(messageOf(TODAY, '09:00', taskKey(r1, today.id, TODAY)).body, '寫週報(今天到期)')
    assert.equal(messageOf(TODAY, '09:00', taskKey(r2, later.id, TODAY)).body, '報稅(3 天後到期)')
    assert.equal(messageOf(TODAY, '09:00', taskKey(r3, noDate.id, TODAY)).body, '整理照片')
    assert.equal(messageOf(TODAY, '09:00', taskKey(r4, overdue.id, TODAY)).body, '繳電費(逾期)')
  })

  test('a relative reminder follows a changed due date', () => {
    allSummariesOff()
    const t = createTask({ title: '繳電費', dueDate: TOMORROW })
    const r = relativeReminder(t.id, 1, '20:00')
    updateTask(t.id, { dueDate: '2026-09-21' })

    assert.deepEqual(keysAt(TODAY, '20:00'), [])
    assert.deepEqual(keysAt(TOMORROW, '20:00'), [taskKey(r, t.id, TOMORROW)])
  })

  test('with the due date cleared, relative reminders wait and absolute ones are still sent', () => {
    allSummariesOff()
    const t = createTask({ title: '繳電費', dueDate: TODAY })
    relativeReminder(t.id, 0, '09:00')
    const absolute = absoluteReminder(t.id, TODAY, '09:00')
    updateTask(t.id, { dueDate: null })

    assert.deepEqual(keysAt(TODAY, '09:00'), [taskKey(absolute, t.id, TODAY)])
  })

  test('an absolute reminder is due on its date from its time, caught up that day only', () => {
    allSummariesOff()
    const t = createTask({ title: '打電話給房東' })
    const r = absoluteReminder(t.id, TODAY, '10:30')

    assert.deepEqual(keysAt(TODAY, '10:29'), [])
    assert.deepEqual(keysAt(TODAY, '23:59'), [taskKey(r, t.id, TODAY)])
    assert.deepEqual(keysAt(TOMORROW, '10:30'), [])
  })

  test('are not sent for a finished task, but recorded as sent for the day', () => {
    allSummariesOff()
    const t = createTask({ title: '繳電費', dueDate: TODAY })
    const r = relativeReminder(t.id, 0, '09:00')
    updateTask(t.id, { done: true })

    assert.deepEqual(keysAt(TODAY, '09:00'), [])
    assert.ok(sentRows().some((row) => row.key === `reminder:${r.id}:${t.id}:09:00` && row.date === TODAY))

    // 取消完成後,當天晚一點也不會突然收到
    updateTask(t.id, { done: false })
    assert.deepEqual(keysAt(TODAY, '10:00'), [])
  })
})

describe('recurrence rule reminders', () => {
  function instancesOf(ruleId: number) {
    return listTasks({ today: TODAY }).filter((row) => row.recurrenceRuleId === ruleId)
  }

  test('apply to each instance by its own due date', () => {
    allSummariesOff()
    const source = createTask({ title: '倒垃圾', dueDate: TODAY })
    const rule = createRuleFromTask(source.id, { freq: 'daily', interval: 1, startDate: TODAY }, TODAY)
    const r = createReminder({ ruleId: rule.id }, { kind: 'relative', daysBefore: 1, time: '20:00' }, SETUP_NOW)
    const tomorrowInstance = instancesOf(rule.id).find((row) => row.dueDate === TOMORROW)
    assert.ok(tomorrowInstance)

    // 今天到期的那個實例,提醒時刻是昨天,已經過了
    assert.deepEqual(keysAt(TODAY, '20:00'), [taskKey(r, tomorrowInstance.id, TODAY)])
    assert.equal(messageOf(TODAY, '20:00', taskKey(r, tomorrowInstance.id, TODAY)).body, '倒垃圾(明天到期)')
  })

  test('skip a finished instance, and follow an instance whose due date was changed', () => {
    allSummariesOff()
    const source = createTask({ title: '倒垃圾', dueDate: TODAY })
    const rule = createRuleFromTask(source.id, { freq: 'daily', interval: 1, startDate: TODAY }, TODAY)
    createReminder({ ruleId: rule.id }, { kind: 'relative', daysBefore: 0, time: '19:00' }, SETUP_NOW)
    const instances = instancesOf(rule.id)
    const todayInstance = instances.find((row) => row.dueDate === TODAY)
    const tomorrowInstance = instances.find((row) => row.dueDate === TOMORROW)
    assert.ok(todayInstance && tomorrowInstance)

    updateTask(todayInstance.id, { done: true })
    assert.deepEqual(keysAt(TODAY, '19:00'), [])

    // 明天的實例改成今天到期:今天 19:00 就提醒它
    updateTask(tomorrowInstance.id, { dueDate: TODAY })
    assert.equal(keysAt(TODAY, '19:30').length, 1)
  })
})

describe('markTaskNotificationsSent', () => {
  test('records each key for its date, and ignores keys already recorded', () => {
    const h = createHabit({ name: '冥想', periodType: 'daily', target: 1 }, TODAY)
    const r = habitReminder(h.id, '07:00')
    const keys = [`summary:morning@${TODAY}`, habitKey(r, TODAY)]

    markTaskNotificationsSent(keys)
    markTaskNotificationsSent(keys)

    assert.deepEqual(sentRows(), [
      { key: `reminder:${r.id}:07:00`, date: TODAY },
      { key: 'summary:morning', date: TODAY },
    ])
  })
})

describe('due order', () => {
  test('summaries first, then reminders by time, then by reminder id', () => {
    createTask({ title: '寫週報', dueDate: TODAY })
    const stretch = createHabit({ name: '伸展', periodType: 'daily', target: 1 }, TODAY)
    const bill = createTask({ title: '繳電費', dueDate: TOMORROW })
    const meditation = createHabit({ name: '冥想', periodType: 'daily', target: 1 }, TODAY)
    const late = habitReminder(stretch.id, '07:30')
    const billReminder = relativeReminder(bill.id, 1, '07:00')
    const early = habitReminder(meditation.id, '07:00')

    assert.deepEqual(keysAt(TODAY, '08:00'), [
      `summary:morning@${TODAY}`,
      taskKey(billReminder, bill.id, TODAY),
      habitKey(early, TODAY),
      habitKey(late, TODAY),
    ])
  })
})

// ---- 以下規格:卡 4(notify-reminders-ui)的「接下來會送的提醒」 ----
// 範圍:現在之後(不含)到 24 小時後(含)。三則摘要只列開著的,不算內容(沒有內容時到時候不送);
// 個別提醒用目前的狀態判斷:停止中的習慣、本週期已達標的習慣、已完成的任務、沒有到期日的相對提醒都不列。
// 重複規則的提醒,實例還沒產生(超過補齊終點)時照規則展開列出,taskId 是 null。
// 排序:日期、時刻;同時刻摘要在前,再依提醒 id、任務 id。只讀,不寫已送標記
describe('upcomingTaskNotifications', () => {
  function upcomingAt(date: string, time: string) {
    return upcomingTaskNotifications(at(date, time))
  }

  test('lists enabled summaries in the next 24 hours, excluding the current minute', () => {
    saveNotificationSettings(
      settingsWith({ afternoon: { time: '15:00', enabled: false } }),
    )

    assert.deepEqual(upcomingAt(TODAY, '08:00'), [
      { kind: 'summary', date: TODAY, time: '21:00', summary: 'evening', title: '晚上收尾' },
      { kind: 'summary', date: TOMORROW, time: '08:00', summary: 'morning', title: '早上總覽' },
    ])
  })

  test('does not mark anything as sent', () => {
    createTask({ title: '寫週報', dueDate: TODAY })
    upcomingAt(TODAY, '07:00')
    assert.deepEqual(sentRows(), [])
  })

  test('habit reminders: today and tomorrow, skipping paused habits', () => {
    allSummariesOff()
    const h = createHabit({ name: '喝水', periodType: 'daily', target: 8 }, TODAY)
    const r = habitReminder(h.id, '14:00')
    const paused = createHabit({ name: '跑步', periodType: 'daily', target: 1 }, TODAY)
    habitReminder(paused.id, '15:00')
    pauseHabit(paused.id, TODAY)

    assert.deepEqual(upcomingAt(TODAY, '10:00'), [
      { kind: 'habit', date: TODAY, time: '14:00', reminderId: r.id, habitId: h.id, title: '喝水' },
    ])
    assert.deepEqual(upcomingAt(TODAY, '14:00'), [
      { kind: 'habit', date: TOMORROW, time: '14:00', reminderId: r.id, habitId: h.id, title: '喝水' },
    ])
  })

  test('habit reminders: an achieved period is skipped until the next period starts', () => {
    allSummariesOff()
    const daily = createHabit({ name: '伸展', periodType: 'daily', target: 1 }, TODAY)
    addLog(daily.id, TODAY, TODAY)
    const rDaily = habitReminder(daily.id, '19:00')
    // 本週是 09-14 到 09-20,明天仍在本週
    const weekly = createHabit({ name: '冥想', periodType: 'weekly', target: 1 }, '2026-09-14')
    addLog(weekly.id, TODAY, TODAY)
    habitReminder(weekly.id, '20:00')

    // 今天都已達標;明天的時刻還在 24 小時外
    assert.deepEqual(upcomingAt(TODAY, '10:00'), [])
    // 每日的明天是新週期,列出;每週的明天仍在已達標的本週,不列
    assert.deepEqual(upcomingAt(TODAY, '20:00'), [
      { kind: 'habit', date: TOMORROW, time: '19:00', reminderId: rDaily.id, habitId: daily.id, title: '伸展' },
    ])
  })

  test('task reminders: relative follows the due date, absolute uses its own date', () => {
    allSummariesOff()
    const t = createTask({ title: '繳房租', dueDate: TOMORROW })
    const rel = relativeReminder(t.id, 1, '20:00')
    const abs = absoluteReminder(t.id, TOMORROW, '09:00')
    const noDue = createTask({ title: '整理照片' })
    relativeReminder(noDue.id, 0, '12:00')

    assert.deepEqual(upcomingAt(TODAY, '10:00'), [
      { kind: 'task', date: TODAY, time: '20:00', reminderId: rel.id, taskId: t.id, ruleId: null, title: '繳房租' },
      { kind: 'task', date: TOMORROW, time: '09:00', reminderId: abs.id, taskId: t.id, ruleId: null, title: '繳房租' },
    ])

    updateTask(t.id, { done: true })
    assert.deepEqual(upcomingAt(TODAY, '10:00'), [])
  })

  test('rule reminders: each instance, plus occurrences beyond the generated range', () => {
    allSummariesOff()
    const source = createTask({ title: '倒垃圾', dueDate: TODAY })
    const rule = createRuleFromTask(source.id, { freq: 'daily', interval: 1, startDate: TODAY }, TODAY)
    const r = createReminder({ ruleId: rule.id }, { kind: 'relative', daysBefore: 6, time: '09:00' }, SETUP_NOW)
    const instances = listTasks({ today: TODAY }).filter((row) => row.recurrenceRuleId === rule.id)
    // 補齊終點是今天 + 6:今天 09:00 提醒的是 6 天後那一次(已產生);明天 09:00 提醒的是 7 天後(還沒產生)
    const sixDaysLater = instances.find((row) => row.dueDate === '2026-09-25')
    assert.ok(sixDaysLater)
    assert.ok(!instances.some((row) => row.dueDate === '2026-09-26'))

    assert.deepEqual(upcomingAt(TODAY, '08:00'), [
      { kind: 'task', date: TODAY, time: '09:00', reminderId: r.id, taskId: sixDaysLater.id, ruleId: rule.id, title: '倒垃圾' },
    ])
    assert.deepEqual(upcomingAt(TODAY, '10:00'), [
      { kind: 'task', date: TOMORROW, time: '09:00', reminderId: r.id, taskId: null, ruleId: rule.id, title: '倒垃圾' },
    ])
  })

  test('orders by date and time; summaries first at the same time, then reminder id', () => {
    saveNotificationSettings(
      settingsWith({
        morning: { time: '08:00', enabled: false },
        afternoon: { time: '15:00', enabled: false },
        evening: { time: '20:00', enabled: true },
      }),
    )
    const h = createHabit({ name: '喝水', periodType: 'daily', target: 8 }, TODAY)
    const late = habitReminder(h.id, '21:00')
    const same = habitReminder(h.id, '20:00')

    assert.deepEqual(
      upcomingAt(TODAY, '19:00').map((item) => [item.date, item.time, item.kind]),
      [
        [TODAY, '20:00', 'summary'],
        [TODAY, '20:00', 'habit'],
        [TODAY, '21:00', 'habit'],
      ],
    )
    // 同時刻的排序不是靠 id:晚建立的 20:00 排在 21:00 前
    assert.ok(same.id > late.id)
  })
})
