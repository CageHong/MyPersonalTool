// 必須是第一個 import:在 db 連線建立前切到記憶體資料庫
import '../test/setup'
import assert from 'node:assert/strict'
import { before, beforeEach, describe, test } from 'node:test'
import { applyMigrations, db } from '../db'
import { habit, task, taskNotificationSent, taskNotificationSetting } from '../db/schema'
import { addLog, createHabit, listHabits, pauseHabit, removeLog, updateHabit } from './habits'
import { createTask, updateTask } from './tasks'
import { ValidationError } from './errors'
import {
  dueTaskNotifications,
  getNotificationSettings,
  markTaskNotificationsSent,
  saveNotificationSettings,
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

describe('habit.reminderTime', () => {
  test('is null unless given, and can be set on create', () => {
    const plain = createHabit({ name: '閱讀', periodType: 'daily', target: 1 }, TODAY)
    const reminded = createHabit({ name: '伸展', periodType: 'daily', target: 1, reminderTime: '19:30' }, TODAY)

    assert.equal(plain.reminderTime, null)
    assert.equal(reminded.reminderTime, '19:30')
  })

  test('can be set and cleared by updateHabit, and shows up in listHabits', () => {
    const created = createHabit({ name: '閱讀', periodType: 'daily', target: 1 }, TODAY)

    assert.equal(updateHabit(created.id, { reminderTime: '20:00' }, TODAY).reminderTime, '20:00')
    assert.equal(listHabits(TODAY).find((row) => row.id === created.id)?.reminderTime, '20:00')
    assert.equal(updateHabit(created.id, { reminderTime: null }, TODAY).reminderTime, null)
  })

  test('rejects values that are not HH:MM', () => {
    const created = createHabit({ name: '閱讀', periodType: 'daily', target: 1 }, TODAY)

    assertRejects(() => updateHabit(created.id, { reminderTime: '7:00' }, TODAY), {
      reminderTime: 'invalid_value',
    })
    assertRejects(
      () => createHabit({ name: '伸展', periodType: 'daily', target: 1, reminderTime: '25:00' }, TODAY),
      { reminderTime: 'invalid_value' },
    )
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

describe('habit reminders', () => {
  test('are due from the reminder time while the habit has not reached its target', () => {
    const habitRow = createHabit(
      { name: '冥想', periodType: 'weekly', target: 6, reminderTime: '19:00' },
      '2026-09-14',
    )
    addLog(habitRow.id, '2026-09-15', TODAY)
    const key = `habit:${habitRow.id}@${TODAY}`

    assert.ok(!keysAt(TODAY, '18:59').includes(key))
    assert.deepEqual(messageOf(TODAY, '19:00', key), { title: '習慣提醒', body: '冥想 1/6' })
  })

  test('are caught up for the rest of the day, then gone', () => {
    const habitRow = createHabit({ name: '冥想', periodType: 'daily', target: 1, reminderTime: '07:00' }, TODAY)

    assert.ok(keysAt(TODAY, '23:59').includes(`habit:${habitRow.id}@${TODAY}`))
    assert.ok(keysAt(TOMORROW, '06:59').every((key) => !key.startsWith(`habit:${habitRow.id}@`)))
  })

  test('are not sent when the target is already met, but recorded as sent for the day', () => {
    const habitRow = createHabit({ name: '伸展', periodType: 'daily', target: 1, reminderTime: '19:00' }, TODAY)
    addLog(habitRow.id, TODAY, TODAY)
    const key = `habit:${habitRow.id}@${TODAY}`

    assert.ok(!keysAt(TODAY, '19:00').includes(key))
    assert.ok(sentRows().some((row) => row.key === `habit:${habitRow.id}` && row.date === TODAY))

    // 撤銷紀錄後,當天晚一點也不會突然收到
    removeLog(habitRow.id, TODAY)
    assert.ok(!keysAt(TODAY, '20:00').includes(key))
  })

  test('are not due for a paused habit', () => {
    const habitRow = createHabit({ name: '跑步', periodType: 'weekly', target: 3, reminderTime: '19:00' }, TODAY)
    pauseHabit(habitRow.id, TODAY)

    assert.ok(!keysAt(TODAY, '19:00').includes(`habit:${habitRow.id}@${TODAY}`))
  })

  test('for a habit without a target, are always sent at the time, with just the name', () => {
    const habitRow = createHabit({ name: '記體重', periodType: 'daily', target: null, reminderTime: '07:00' }, TODAY)
    addLog(habitRow.id, TODAY, TODAY)

    assert.deepEqual(messageOf(TODAY, '07:00', `habit:${habitRow.id}@${TODAY}`), {
      title: '習慣提醒',
      body: '記體重',
    })
  })

  test('are not due for a habit without a reminder time', () => {
    createHabit({ name: '冥想', periodType: 'daily', target: 1 }, TODAY)
    saveNotificationSettings(
      settingsWith({
        morning: { time: '08:00', enabled: false },
        afternoon: { time: '15:00', enabled: false },
        evening: { time: '21:00', enabled: false },
      }),
    )

    assert.deepEqual(keysAt(TODAY, '23:59'), [])
  })
})

describe('markTaskNotificationsSent', () => {
  test('records each key for its date, and ignores keys already recorded', () => {
    const habitRow = createHabit({ name: '冥想', periodType: 'daily', target: 1, reminderTime: '07:00' }, TODAY)
    const keys = [`summary:morning@${TODAY}`, `habit:${habitRow.id}@${TODAY}`]

    markTaskNotificationsSent(keys)
    markTaskNotificationsSent(keys)

    assert.deepEqual(sentRows(), [
      { key: `habit:${habitRow.id}`, date: TODAY },
      { key: 'summary:morning', date: TODAY },
    ])
  })
})

describe('due order', () => {
  test('summaries come before habit reminders, habit reminders in habit list order', () => {
    createTask({ title: '寫週報', dueDate: TODAY })
    const stretch = createHabit({ name: '伸展', periodType: 'daily', target: 1, reminderTime: '07:00' }, TODAY)
    const meditation = createHabit({ name: '冥想', periodType: 'daily', target: 1, reminderTime: '08:00' }, TODAY)

    assert.deepEqual(keysAt(TODAY, '08:00'), [
      `summary:morning@${TODAY}`,
      `habit:${stretch.id}@${TODAY}`,
      `habit:${meditation.id}@${TODAY}`,
    ])
  })
})
