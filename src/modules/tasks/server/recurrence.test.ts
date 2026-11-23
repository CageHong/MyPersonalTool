// 必須是第一個 import:在 db 連線建立前切到記憶體資料庫
import '../test/setup'
import assert from 'node:assert/strict'
import { before, describe, test } from 'node:test'
import { asc, eq, sql } from 'drizzle-orm'
import { applyMigrations, db } from '../db'
import { task, taskChecklistItem, taskRecurrenceRule, taskRecurrenceRuleChecklistItem, taskReminder } from '../db/schema'
import { addDaysUtc } from '../lib/recurrence'
import {
  createChecklistItem,
  deleteChecklistItem,
  reorderChecklistItems,
  updateChecklistItem,
} from './checklist'
import { NotFoundError } from './errors'
import { createReminder, listReminders } from './reminders'
import {
  createRuleFromTask,
  fillInstances,
  getRule,
  stopRule,
  updateRule,
  type RecurrenceRule,
} from './recurrence'
import { createTask, deleteTask, listTasks, updateTask, ValidationError } from './tasks'

const TODAY = '2026-09-18'
// 補齊終點 = 今天 + 6
const END = '2026-09-24'

before(() => {
  // 保險:萬一 test/setup 沒先載入,不在真的資料庫上跑 migration 與寫入
  assert.equal(process.env.TASKS_DB_PATH, ':memory:')
  // 跑真正的 migration 檔,驗的是 SQL 裡的 CHECK、外鍵與唯一鍵
  applyMigrations(db)
})

// 直接寫一條規則,好設定任意的水位線
function insertRule(
  overrides: Partial<typeof taskRecurrenceRule.$inferInsert> = {},
  template: string[] = [],
): RecurrenceRule {
  const [rule] = db
    .insert(taskRecurrenceRule)
    .values({
      freq: 'daily',
      interval: 1,
      weekdays: null,
      startDate: TODAY,
      title: 'rule',
      notes: null,
      priority: 0,
      generatedThrough: null,
      endedAt: null,
      createdAt: 0,
      updatedAt: 0,
      ...overrides,
    })
    .returning()
    .all()
  template.forEach((title, position) => {
    db.insert(taskRecurrenceRuleChecklistItem)
      .values({ ruleId: rule.id, title, position, createdAt: 0, updatedAt: 0 })
      .run()
  })
  return rule
}

function ruleRow(ruleId: number) {
  return db.select().from(taskRecurrenceRule).where(eq(taskRecurrenceRule.id, ruleId)).get()!
}

function instances(ruleId: number) {
  return db
    .select()
    .from(task)
    .where(eq(task.recurrenceRuleId, ruleId))
    .orderBy(asc(task.occurrenceDate))
    .all()
}

function instanceOn(ruleId: number, date: string) {
  return instances(ruleId).find((instance) => instance.occurrenceDate === date)
}

function dates(ruleId: number): string[] {
  return instances(ruleId).map((instance) => instance.occurrenceDate!)
}

function checklistOf(taskId: number) {
  return db
    .select()
    .from(taskChecklistItem)
    .where(eq(taskChecklistItem.taskId, taskId))
    .orderBy(asc(taskChecklistItem.position))
    .all()
}

function templateOf(ruleId: number): string[] {
  return db
    .select()
    .from(taskRecurrenceRuleChecklistItem)
    .where(eq(taskRecurrenceRuleChecklistItem.ruleId, ruleId))
    .orderBy(asc(taskRecurrenceRuleChecklistItem.position))
    .all()
    .map((item) => item.title)
}

function range(from: string, to: string): string[] {
  const result: string[] = []
  for (let date = from; date <= to; date = addDaysUtc(date, 1)) {
    result.push(date)
  }
  return result
}

// task.edited_at 由 recurring-skip 新增;用 SQL 讀,欄位還沒有時測試在執行期失敗,型別檢查照樣能過
function editedAtOf(taskId: number): number | null {
  const row = db.get<{ edited_at: number | null }>(sql`select edited_at from task where id = ${taskId}`)
  return row.edited_at
}

function complete(taskId: number) {
  updateTask(taskId, { done: true })
}

describe('fillInstances', () => {
  test('fills through today + 6 and sets the watermark; a second call adds nothing', () => {
    const rule = insertRule()

    fillInstances(TODAY)

    assert.deepEqual(dates(rule.id), range(TODAY, END))
    assert.equal(ruleRow(rule.id).generatedThrough, END)

    fillInstances(TODAY)

    assert.equal(instances(rule.id).length, 7)
  })

  test('a deleted instance is not regenerated', () => {
    const rule = insertRule()
    fillInstances(TODAY)
    deleteTask(instanceOn(rule.id, '2026-09-20')!.id)

    fillInstances(TODAY)
    fillInstances('2026-09-19')

    // 9/19 補齊時 9/18 已錯過、沒動過,被跳過(§6a)
    assert.deepEqual(
      dates(rule.id),
      range('2026-09-19', '2026-09-25').filter((date) => date !== '2026-09-20'),
    )
  })

  // §6a 錯過就跳過:水位線落後時不產生今天以前的日期
  test('a watermark 30 days behind does not create past dates', () => {
    const rule = insertRule({ startDate: '2026-08-01', generatedThrough: '2026-08-19' })

    fillInstances(TODAY)

    assert.deepEqual(dates(rule.id), range(TODAY, END))
    assert.equal(ruleRow(rule.id).generatedThrough, END)
  })

  test('instances copy the template; editing an instance leaves the rule alone', () => {
    const rule = insertRule({ title: 'pay rent', notes: 'bank', priority: 3 }, ['log in', 'transfer'])

    fillInstances(TODAY)

    const instance = instanceOn(rule.id, TODAY)!
    assert.equal(instance.title, 'pay rent')
    assert.equal(instance.notes, 'bank')
    assert.equal(instance.priority, 3)
    assert.equal(instance.dueDate, TODAY)
    const items = checklistOf(instance.id)
    assert.deepEqual(
      items.map((item) => item.title),
      ['log in', 'transfer'],
    )
    assert.ok(items.every((item) => item.completedAt === null))

    updateTask(instance.id, { title: 'pay rent (late)' })
    updateChecklistItem(items[0].id, { done: true })

    assert.equal(ruleRow(rule.id).title, 'pay rent')
    assert.deepEqual(templateOf(rule.id), ['log in', 'transfer'])
    assert.ok(checklistOf(instanceOn(rule.id, '2026-09-19')!.id).every((item) => item.completedAt === null))
  })

  test('listTasks fills before reading', () => {
    const rule = insertRule()

    const listed = listTasks({ today: TODAY })

    assert.equal(listed.filter((row) => row.recurrenceRuleId === rule.id).length, 7)
  })
})

// §6a 錯過就跳過:未完成、occurrenceDate 與 dueDate 都早於今天、沒被編輯過的實例,補齊時刪除
describe('skipping missed instances', () => {
  const PAST = '2026-09-15'

  // 9/15 那天補齊(產生 9/15..9/21),之後才在今天補齊
  function ruleFilledOn(day: string, template: string[] = []) {
    const rule = insertRule({ startDate: day }, template)
    fillInstances(day)
    return rule
  }

  test('untouched missed instances are deleted on the next fill, with their checklist', () => {
    const rule = ruleFilledOn(PAST, ['item'])
    const missedId = instanceOn(rule.id, '2026-09-16')!.id

    fillInstances(TODAY)

    assert.deepEqual(dates(rule.id), range(TODAY, END))
    assert.equal(checklistOf(missedId).length, 0)
  })

  test("today's instance is not missed yet", () => {
    const rule = ruleFilledOn(PAST)

    fillInstances(TODAY)

    assert.ok(instanceOn(rule.id, TODAY))
  })

  test('completed missed instances are kept', () => {
    const rule = ruleFilledOn(PAST)
    complete(instanceOn(rule.id, '2026-09-16')!.id)

    fillInstances(TODAY)

    assert.deepEqual(dates(rule.id), ['2026-09-16', ...range(TODAY, END)])
  })

  // 每一種寫入都算編輯過;勾完成再取消後是未完成,但仍然編輯過
  const edits: Array<[string, (taskId: number) => void]> = [
    ['title', (id) => updateTask(id, { title: 'changed' })],
    ['notes', (id) => updateTask(id, { notes: 'note' })],
    ['priority', (id) => updateTask(id, { priority: 3 })],
    ['pinned', (id) => updateTask(id, { pinned: true })],
    ['done then undone', (id) => {
      updateTask(id, { done: true })
      updateTask(id, { done: false })
    }],
    ['checklist add', (id) => {
      createChecklistItem(id, 'new')
    }],
    ['checklist toggle', (id) => {
      updateChecklistItem(checklistOf(id)[0].id, { done: true })
    }],
    ['checklist rename', (id) => {
      updateChecklistItem(checklistOf(id)[0].id, { title: 'renamed' })
    }],
    ['checklist delete', (id) => deleteChecklistItem(checklistOf(id)[0].id)],
    ['checklist reorder', (id) => {
      const ids = checklistOf(id).map((item) => item.id)
      reorderChecklistItems(id, [...ids].reverse())
    }],
  ]
  for (const [name, edit] of edits) {
    test(`an edited missed instance is kept as overdue (${name})`, () => {
      const rule = ruleFilledOn(PAST, ['a', 'b'])
      const edited = instanceOn(rule.id, '2026-09-16')!
      edit(edited.id)
      assert.notEqual(editedAtOf(edited.id), null)

      fillInstances(TODAY)

      assert.deepEqual(dates(rule.id), ['2026-09-16', ...range(TODAY, END)])
    })
  }

  test('a fresh instance has editedAt null', () => {
    const rule = ruleFilledOn(TODAY)

    assert.ok(instances(rule.id).every((instance) => editedAtOf(instance.id) === null))
  })

  test('skipping also runs when nothing new needs to be generated', () => {
    const rule = ruleFilledOn(PAST)
    // 水位線已經在終點之後:這次補齊不產生新日期,但錯過的照樣要刪
    db.update(taskRecurrenceRule)
      .set({ generatedThrough: '2026-10-31' })
      .where(eq(taskRecurrenceRule.id, rule.id))
      .run()

    fillInstances(TODAY)

    assert.deepEqual(dates(rule.id), ['2026-09-18', '2026-09-19', '2026-09-20', '2026-09-21'])
  })

  test('instances of a stopped rule are left alone', () => {
    const rule = ruleFilledOn(PAST)
    stopRule(rule.id, PAST)

    fillInstances(TODAY)

    // 停止後剩下的實例像一般任務,不再套「錯過就跳過」
    assert.deepEqual(dates(rule.id), [PAST])
  })

  test('the original task of createRuleFromTask counts as edited', () => {
    const source = createTask({ title: 'from task', dueDate: TODAY })
    const rule = createRuleFromTask(source.id, { freq: 'daily', interval: 1, startDate: TODAY }, TODAY)
    assert.notEqual(editedAtOf(source.id), null)

    fillInstances('2026-09-20')

    assert.deepEqual(dates(rule.id), [TODAY, ...range('2026-09-20', '2026-09-26')])
  })

  test('listTasks applies the skip before reading', () => {
    const rule = ruleFilledOn(PAST)

    const listed = listTasks({ today: TODAY }).filter((row) => row.recurrenceRuleId === rule.id)

    assert.ok(listed.every((row) => row.occurrenceDate! >= TODAY))
  })
})

// 9/15 補齊過一次,今天再補齊:9/16 與 9/20 已完成、9/17 編輯過(保留為逾期)、
// 9/15 沒動過(今天補齊時被跳過);今天的實例勾了一個 checklist 項
function setupRuleWithHistory() {
  const rule = insertRule({ title: 'old', startDate: '2026-09-15' }, ['old item'])
  fillInstances('2026-09-15')
  complete(instanceOn(rule.id, '2026-09-16')!.id)
  complete(instanceOn(rule.id, '2026-09-20')!.id)
  updateTask(instanceOn(rule.id, '2026-09-17')!.id, { notes: 'edited' })
  fillInstances(TODAY)
  const todayItem = checklistOf(instanceOn(rule.id, TODAY)!.id)[0]
  updateChecklistItem(todayItem.id, { done: true })
  return { rule, todayItemId: todayItem.id, before: instances(rule.id) }
}

function assertPastAndCompletedUnchanged(
  ruleId: number,
  before: ReturnType<typeof instances>,
  todayItemId: number,
) {
  const kept = before.filter(
    (instance) => instance.occurrenceDate! <= TODAY || instance.completedAt !== null,
  )
  for (const instance of kept) {
    assert.deepEqual(instanceOn(ruleId, instance.occurrenceDate!), instance)
  }
  const todayItem = checklistOf(instanceOn(ruleId, TODAY)!.id).find((item) => item.id === todayItemId)
  assert.ok(todayItem && todayItem.completedAt !== null)
}

describe('updateRule', () => {
  test('keeps completed, today and overdue instances; regenerates future incomplete ones', () => {
    const { rule, todayItemId, before } = setupRuleWithHistory()

    updateRule(rule.id, { interval: 2, title: 'new', checklist: ['new item'] }, TODAY)

    assertPastAndCompletedUnchanged(rule.id, before, todayItemId)
    // 9/15 起每 2 天:今天之後是 19、21、23;20 是舊規則下已完成的;9/15 已被跳過
    assert.deepEqual(dates(rule.id), [
      '2026-09-16',
      '2026-09-17',
      '2026-09-18',
      '2026-09-19',
      '2026-09-20',
      '2026-09-21',
      '2026-09-23',
    ])
    for (const date of ['2026-09-19', '2026-09-21', '2026-09-23']) {
      const instance = instanceOn(rule.id, date)!
      assert.equal(instance.title, 'new')
      assert.deepEqual(
        checklistOf(instance.id).map((item) => item.title),
        ['new item'],
      )
    }
    assert.equal(instanceOn(rule.id, '2026-09-20')!.title, 'old')
    assert.deepEqual(templateOf(rule.id), ['new item'])
    assert.equal(ruleRow(rule.id).generatedThrough, END)
  })

  test('fills the lagging watermark with the old rule first', () => {
    const rule = insertRule(
      { title: 'old', startDate: '2026-09-01', generatedThrough: '2026-09-12' },
      ['old item'],
    )

    updateRule(rule.id, { title: 'new', checklist: ['new item'] }, TODAY)

    // 錯過就跳過:9/13..9/17 不產生;今天的實例由舊規則產生,改規則不動今天
    assert.ok(instances(rule.id).every((instance) => instance.occurrenceDate! >= TODAY))
    const todayInstance = instanceOn(rule.id, TODAY)!
    assert.equal(todayInstance.title, 'old')
    assert.deepEqual(
      checklistOf(todayInstance.id).map((item) => item.title),
      ['old item'],
    )
    assert.equal(instanceOn(rule.id, '2026-09-19')!.title, 'new')
  })

  test('rejects a stopped rule', () => {
    const rule = insertRule({ endedAt: 1 })

    assert.throws(() => updateRule(rule.id, { title: 'new' }, TODAY), ValidationError)
  })
})

describe('stopRule', () => {
  test('keeps completed, today and overdue instances; later fills add nothing; idempotent', () => {
    const { rule, todayItemId, before } = setupRuleWithHistory()

    const first = stopRule(rule.id, TODAY)

    assertPastAndCompletedUnchanged(rule.id, before, todayItemId)
    assert.deepEqual(dates(rule.id), [
      '2026-09-16',
      '2026-09-17',
      '2026-09-18',
      '2026-09-20',
    ])
    assert.notEqual(first.endedAt, null)

    fillInstances('2026-10-01')
    const second = stopRule(rule.id, TODAY)

    assert.deepEqual(second, first)
    assert.deepEqual(dates(rule.id), [
      '2026-09-16',
      '2026-09-17',
      '2026-09-18',
      '2026-09-20',
    ])
  })

  test('fills the lagging watermark before stopping', () => {
    const rule = insertRule({ startDate: '2026-09-01', generatedThrough: '2026-09-12' })

    stopRule(rule.id, TODAY)

    // 補到最新時錯過的不產生,只有今天的實例
    assert.deepEqual(dates(rule.id), [TODAY])
  })
})

describe('createRuleFromTask', () => {
  test('turns the task into the first instance aligned to the rule', () => {
    const source = createTask({
      title: 'gym',
      notes: 'legs',
      priority: 5,
      dueDate: '2026-09-01',
      dueTime: '07:00',
      durationMinutes: 60,
    })
    createChecklistItem(source.id, 'shoes')
    createChecklistItem(source.id, 'towel')

    // 9/16 是星期三,每週一與週四 → 第一次是 9/17
    const rule = createRuleFromTask(
      source.id,
      { freq: 'weekly', interval: 1, weekdays: (1 << 0) | (1 << 3), startDate: '2026-09-16' },
      TODAY,
    )

    const first = db.select().from(task).where(eq(task.id, source.id)).get()!
    assert.equal(first.recurrenceRuleId, rule.id)
    assert.equal(first.occurrenceDate, '2026-09-17')
    assert.equal(first.dueDate, '2026-09-17')
    assert.equal(first.dueTime, '07:00')
    assert.equal(first.durationMinutes, 60)
    assert.equal(rule.title, 'gym')
    assert.equal(rule.notes, 'legs')
    assert.equal(rule.priority, 5)
    assert.deepEqual(templateOf(rule.id), ['shoes', 'towel'])
    assert.deepEqual(dates(rule.id), ['2026-09-17', '2026-09-21', '2026-09-24'])
    assert.equal(rule.generatedThrough, END)

    assert.throws(
      () => createRuleFromTask(source.id, { freq: 'daily', interval: 1, startDate: TODAY }, TODAY),
      (error: unknown) =>
        error instanceof ValidationError && error.fields.recurrenceRuleId === 'already_set',
    )
  })

  test('does not backfill dates before the rule exists', () => {
    const source = createTask({ title: 'old habit', dueDate: '2026-08-19' })

    const rule = createRuleFromTask(
      source.id,
      { freq: 'daily', interval: 1, startDate: '2026-08-19' },
      TODAY,
    )

    // 原任務維持逾期(它算編輯過,不被跳過),是第一個實例;之後從今天開始,不補 8/20..9/17
    assert.deepEqual(dates(rule.id), ['2026-08-19', ...range(TODAY, END)])
    const first = db.select().from(task).where(eq(task.id, source.id)).get()!
    assert.equal(first.dueDate, '2026-08-19')
    assert.equal(first.occurrenceDate, '2026-08-19')
    assert.equal(rule.generatedThrough, END)
  })

  function ruleCount(): number {
    return db.select().from(taskRecurrenceRule).all().length
  }

  test('a task whose rule was stopped can start a new rule; the old records stay', () => {
    const oldRule = insertRule({ startDate: TODAY })
    fillInstances(TODAY)
    const source = instanceOn(oldRule.id, TODAY)!
    const done = instanceOn(oldRule.id, '2026-09-19')!
    complete(done.id)
    stopRule(oldRule.id, TODAY)
    const endedAt = ruleRow(oldRule.id).endedAt

    const newRule = createRuleFromTask(
      source.id,
      { freq: 'weekly', interval: 1, weekdays: 1 << 0, startDate: TODAY },
      TODAY,
    )

    // 原任務改指向新規則,成為新規則的第一個實例(9/18 週五 → 9/21 週一)
    const moved = db.select().from(task).where(eq(task.id, source.id)).get()!
    assert.equal(moved.recurrenceRuleId, newRule.id)
    assert.equal(moved.dueDate, '2026-09-21')
    assert.deepEqual(dates(newRule.id), ['2026-09-21'])
    // 舊規則仍是已停止,停止時間不變;已完成的實例還在
    assert.notEqual(endedAt, null)
    assert.equal(ruleRow(oldRule.id).endedAt, endedAt)
    assert.deepEqual(
      instances(oldRule.id).map((row) => row.id),
      [done.id],
    )
  })

  test("restarting anchors the new rule on the task's current due date", () => {
    const oldRule = insertRule({ startDate: TODAY })
    fillInstances(TODAY)
    const source = instanceOn(oldRule.id, TODAY)!
    stopRule(oldRule.id, TODAY)
    // 停止後使用者把截止日改到別天;介面以選單裡的日期(= 任務目前的截止日)當錨點送出
    updateTask(source.id, { dueDate: '2026-09-25' })
    const current = db.select().from(task).where(eq(task.id, source.id)).get()!

    const newRule = createRuleFromTask(
      source.id,
      { freq: 'daily', interval: 1, startDate: current.dueDate! },
      TODAY,
    )

    // 伺服器用呼叫端給的 startDate,不自行換成截止日;送的是截止日,結果就對齊截止日
    assert.equal(newRule.startDate, '2026-09-25')
    const moved = db.select().from(task).where(eq(task.id, source.id)).get()!
    assert.equal(moved.dueDate, '2026-09-25')
    assert.equal(moved.occurrenceDate, '2026-09-25')
    // 補齊終點是 today + 6 = 9/24,新規則在範圍內只有原任務
    assert.deepEqual(dates(newRule.id), ['2026-09-25'])
  })

  test('a task whose rule is still active is rejected', () => {
    const rule = insertRule({ startDate: TODAY })
    fillInstances(TODAY)
    const source = instanceOn(rule.id, TODAY)!
    const before = ruleCount()

    assert.throws(
      () => createRuleFromTask(source.id, { freq: 'daily', interval: 1, startDate: TODAY }, TODAY),
      (error: unknown) =>
        error instanceof ValidationError && error.fields.recurrenceRuleId === 'already_set',
    )
    assert.equal(ruleCount(), before)
  })

  test('rejects a completed task', () => {
    const source = createTask({ title: 'done', dueDate: '2026-09-01' })
    complete(source.id)
    const before = ruleCount()

    assert.throws(
      () => createRuleFromTask(source.id, { freq: 'daily', interval: 1, startDate: TODAY }, TODAY),
      (error: unknown) => error instanceof ValidationError && error.fields.taskId === 'completed',
    )
    assert.equal(ruleCount(), before)
  })

  test('rejects a task with scheduledAt', () => {
    const source = createTask({ title: 'meeting', dueDate: '2026-09-01', scheduledAt: 1_790_000_000 })
    const before = ruleCount()

    assert.throws(
      () => createRuleFromTask(source.id, { freq: 'daily', interval: 1, startDate: TODAY }, TODAY),
      (error: unknown) => error instanceof ValidationError && error.fields.scheduledAt === 'set',
    )
    assert.equal(ruleCount(), before)
    const after = db.select().from(task).where(eq(task.id, source.id)).get()!
    assert.equal(after.dueDate, '2026-09-01')
    assert.equal(after.scheduledAt, 1_790_000_000)
    assert.equal(after.recurrenceRuleId, null)
  })
})

describe('getRule', () => {
  test('returns the rule with template titles in order, also after stopping', () => {
    const rule = insertRule({ title: 'water plants', freq: 'weekly', weekdays: 1 << 5 }, [
      'balcony',
      'kitchen',
    ])
    // position 相同時以 id 打破平手
    db.insert(taskRecurrenceRuleChecklistItem)
      .values({ ruleId: rule.id, title: 'hall', position: 1, createdAt: 0, updatedAt: 0 })
      .run()

    assert.deepEqual(getRule(rule.id), { ...ruleRow(rule.id), checklist: ['balcony', 'kitchen', 'hall'] })

    stopRule(rule.id, TODAY)

    assert.notEqual(getRule(rule.id).endedAt, null)
  })

  test('an unknown id throws NotFoundError', () => {
    assert.throws(() => getRule(999_999), NotFoundError)
  })
})

describe('startDate must be a real calendar date', () => {
  for (const startDate of ['2026-13-01', '2026-02-30', '2027-02-29']) {
    test(`rejects ${startDate}`, () => {
      const { id } = createTask({ title: 'task' })

      assert.throws(
        () => createRuleFromTask(id, { freq: 'daily', interval: 1, startDate }, TODAY),
        (error: unknown) => error instanceof ValidationError && error.fields.startDate === 'invalid_format',
      )
    })
  }

  test('accepts 2028-02-29', () => {
    const { id } = createTask({ title: 'task' })

    const rule = createRuleFromTask(id, { freq: 'yearly', interval: 1, startDate: '2028-02-29' }, TODAY)

    assert.equal(rule.startDate, '2028-02-29')
  })
})

describe('unique occurrence', () => {
  test('a second row for the same rule and occurrence date violates the unique key', () => {
    const rule = insertRule({ endedAt: 1 })
    const row = {
      title: 'dup',
      createdAt: 0,
      recurrenceRuleId: rule.id,
      occurrenceDate: TODAY,
    }
    db.insert(task).values(row).run()

    assert.throws(() => db.insert(task).values(row).run(), /UNIQUE/)
  })
})

describe('until', () => {
  function ruleCount(): number {
    return db.select().from(taskRecurrenceRule).all().length
  }

  test('createRuleFromTask rejects an until before the first occurrence', () => {
    const source = createTask({ title: 'task', dueDate: TODAY })
    const before = ruleCount()

    // 9/18 是星期五:第一個星期一是 9/21
    assert.throws(
      () =>
        createRuleFromTask(
          source.id,
          { freq: 'weekly', interval: 1, weekdays: 1 << 0, startDate: TODAY, until: '2026-09-20' },
          TODAY,
        ),
      (error: unknown) => error instanceof ValidationError && error.fields.until === 'before_start',
    )
    assert.equal(ruleCount(), before)
    assert.equal(db.select().from(task).where(eq(task.id, source.id)).get()!.recurrenceRuleId, null)
  })

  test('createRuleFromTask with until equal to the first occurrence makes one instance', () => {
    const source = createTask({ title: 'task', dueDate: TODAY })

    const rule = createRuleFromTask(
      source.id,
      { freq: 'daily', interval: 1, startDate: TODAY, until: TODAY },
      TODAY,
    )

    assert.equal(rule.until, TODAY)
    assert.deepEqual(dates(rule.id), [TODAY])
  })

  test('shortening until removes future incomplete instances beyond it; keeps today, overdue, completed', () => {
    const { rule, todayItemId, before } = setupRuleWithHistory()

    updateRule(rule.id, { until: '2026-09-21' }, TODAY)

    assertPastAndCompletedUnchanged(rule.id, before, todayItemId)
    // 9/16–9/18 已經發生(9/15 已被跳過);9/19–9/21 用新規則重生;9/20 是已完成的舊實例;9/22 之後消失
    assert.deepEqual(dates(rule.id), [
      '2026-09-16',
      '2026-09-17',
      '2026-09-18',
      '2026-09-19',
      '2026-09-20',
      '2026-09-21',
    ])
  })

  test('extending until fills the new range', () => {
    const rule = insertRule({ startDate: TODAY, until: '2026-09-19' })
    fillInstances(TODAY)
    assert.deepEqual(dates(rule.id), [TODAY, '2026-09-19'])

    updateRule(rule.id, { until: '2026-09-22' }, TODAY)

    assert.deepEqual(dates(rule.id), range(TODAY, '2026-09-22'))
  })

  test('until: null goes back to never ending', () => {
    const rule = insertRule({ startDate: TODAY, until: '2026-09-19' })
    fillInstances(TODAY)

    const updated = updateRule(rule.id, { until: null }, TODAY)

    assert.equal(updated.until, null)
    assert.deepEqual(dates(rule.id), range(TODAY, END))
  })

  test('an expired rule produces nothing on fill and is not marked ended', () => {
    const rule = insertRule({ startDate: '2026-09-01', until: '2026-09-10', generatedThrough: '2026-09-10' })

    fillInstances(TODAY)

    assert.deepEqual(dates(rule.id), [])
    assert.equal(ruleRow(rule.id).endedAt, null)
  })

  for (const until of ['2026-13-01', '2026-02-30']) {
    test(`rejects until ${until}`, () => {
      const { id } = createTask({ title: 'task' })

      assert.throws(
        () => createRuleFromTask(id, { freq: 'daily', interval: 1, startDate: TODAY, until }, TODAY),
        (error: unknown) => error instanceof ValidationError && error.fields.until === 'invalid_format',
      )
    })
  }
})

// ---- 以下規格:卡 4(notify-reminders-ui)。只有排程欄位改變才重建實例;其他欄位就地更新 ----
// 排程欄位:freq、interval、weekdays、startDate、until。其他:title、notes、priority、excludeFromSummary、checklist 範本
// 就地更新的範圍與重建相同(今天之後、未完成);實例的 id、dueDate、editedAt、個別提醒都不動
describe('updateRule: non-schedule changes update instances in place', () => {
  // 建立提醒時的「現在」:早於測試用的所有日期
  const SETUP_NOW = new Date(2026, 8, 18, 0, 0)

  function setup() {
    const { rule, todayItemId, before } = setupRuleWithHistory()
    const future = instanceOn(rule.id, '2026-09-21')!
    const reminder = createReminder({ taskId: future.id }, { kind: 'absolute', date: '2026-09-21', time: '09:00' }, SETUP_NOW)
    return { rule, todayItemId, before, future, reminder }
  }

  test('title, notes, priority and excludeFromSummary keep instance ids and their reminders', () => {
    const { rule, todayItemId, before, future, reminder } = setup()
    const futureIdsBefore = before
      .filter((instance) => instance.occurrenceDate! > TODAY && instance.completedAt === null)
      .map((instance) => [instance.occurrenceDate!, instance.id] as const)

    updateRule(rule.id, { title: 'new', notes: 'n', priority: 5, excludeFromSummary: true }, TODAY)

    assertPastAndCompletedUnchanged(rule.id, before, todayItemId)
    assert.deepEqual(
      futureIdsBefore.map(([date]) => [date, instanceOn(rule.id, date)!.id]),
      futureIdsBefore,
    )
    for (const [date] of futureIdsBefore) {
      const instance = instanceOn(rule.id, date)!
      assert.equal(instance.title, 'new')
      assert.equal(instance.notes, 'n')
      assert.equal(instance.priority, 5)
      assert.equal(instance.excludeFromSummary, true)
      assert.equal(instance.editedAt, null)
    }
    assert.deepEqual(listReminders({ taskId: future.id }).map((r) => r.id), [reminder.id])
    assert.equal(instanceOn(rule.id, '2026-09-20')!.title, 'old')
  })

  test('a checklist template change replaces the checklist of future incomplete instances in place', () => {
    const { rule, todayItemId, before, future, reminder } = setup()

    updateRule(rule.id, { checklist: ['a', 'b'] }, TODAY)

    assertPastAndCompletedUnchanged(rule.id, before, todayItemId)
    assert.equal(instanceOn(rule.id, '2026-09-21')!.id, future.id)
    assert.deepEqual(
      checklistOf(future.id).map((item) => [item.title, item.completedAt]),
      [
        ['a', null],
        ['b', null],
      ],
    )
    assert.deepEqual(templateOf(rule.id), ['a', 'b'])
    assert.deepEqual(listReminders({ taskId: future.id }).map((r) => r.id), [reminder.id])
  })

  test('a future instance whose due date was moved keeps that due date', () => {
    const { rule, future } = setup()
    updateTask(future.id, { dueDate: '2026-09-23' })

    updateRule(rule.id, { title: 'new' }, TODAY)

    const after = instanceOn(rule.id, '2026-09-21')!
    assert.equal(after.id, future.id)
    assert.equal(after.dueDate, '2026-09-23')
    assert.equal(after.title, 'new')
  })

  test('the watermark is not reset', () => {
    const { rule } = setup()

    updateRule(rule.id, { title: 'new' }, TODAY)

    assert.equal(ruleRow(rule.id).generatedThrough, END)
  })

  test('a schedule change still regenerates; absolute reminders on removed instances go with them', () => {
    const { rule, future, reminder } = setup()

    updateRule(rule.id, { interval: 2 }, TODAY)

    // 9/15 起每 2 天,9/21 仍是一次,但實例是重新產生的
    const regenerated = instanceOn(rule.id, '2026-09-21')!
    assert.notEqual(regenerated.id, future.id)
    assert.deepEqual(listReminders({ taskId: regenerated.id }), [])
    assert.equal(
      db.select().from(taskReminder).where(eq(taskReminder.id, reminder.id)).all().length,
      0,
    )
  })

  test('schedule and non-schedule changes together regenerate', () => {
    const { rule, future } = setup()

    updateRule(rule.id, { interval: 2, title: 'new' }, TODAY)

    const regenerated = instanceOn(rule.id, '2026-09-21')!
    assert.notEqual(regenerated.id, future.id)
    assert.equal(regenerated.title, 'new')
  })
})
