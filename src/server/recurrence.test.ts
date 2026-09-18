// 必須是第一個 import:在 db 連線建立前切到記憶體資料庫
import '../test/setup'
import assert from 'node:assert/strict'
import { before, describe, test } from 'node:test'
import { asc, eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { db } from '../db'
import { task, taskChecklistItem, taskRecurrenceRule, taskRecurrenceRuleChecklistItem } from '../db/schema'
import { addDaysUtc } from '../lib/recurrence'
import { createChecklistItem, updateChecklistItem } from './checklist'
import {
  createRuleFromTask,
  fillInstances,
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
  migrate(db, { migrationsFolder: './drizzle' })
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

function getRule(ruleId: number) {
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

function complete(taskId: number) {
  updateTask(taskId, { done: true })
}

describe('fillInstances', () => {
  test('fills through today + 6 and sets the watermark; a second call adds nothing', () => {
    const rule = insertRule()

    fillInstances(TODAY)

    assert.deepEqual(dates(rule.id), range(TODAY, END))
    assert.equal(getRule(rule.id).generatedThrough, END)

    fillInstances(TODAY)

    assert.equal(instances(rule.id).length, 7)
  })

  test('a deleted instance is not regenerated', () => {
    const rule = insertRule()
    fillInstances(TODAY)
    deleteTask(instanceOn(rule.id, '2026-09-20')!.id)

    fillInstances(TODAY)
    fillInstances('2026-09-19')

    assert.deepEqual(
      dates(rule.id),
      range(TODAY, '2026-09-25').filter((date) => date !== '2026-09-20'),
    )
  })

  test('a watermark 30 days behind fills every missed date', () => {
    const rule = insertRule({ startDate: '2026-08-01', generatedThrough: '2026-08-19' })

    fillInstances(TODAY)

    assert.deepEqual(dates(rule.id), range('2026-08-20', END))
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

    assert.equal(getRule(rule.id).title, 'pay rent')
    assert.deepEqual(templateOf(rule.id), ['log in', 'transfer'])
    assert.ok(checklistOf(instanceOn(rule.id, '2026-09-19')!.id).every((item) => item.completedAt === null))
  })

  test('listTasks fills before reading', () => {
    const rule = insertRule()

    const listed = listTasks({ today: TODAY })

    assert.equal(listed.filter((row) => row.recurrenceRuleId === rule.id).length, 7)
  })
})

// 9/15 起每天;9/16 與 9/20 已完成,今天的實例勾了一個 checklist 項
function setupRuleWithHistory() {
  const rule = insertRule({ title: 'old', startDate: '2026-09-15' }, ['old item'])
  fillInstances(TODAY)
  complete(instanceOn(rule.id, '2026-09-16')!.id)
  complete(instanceOn(rule.id, '2026-09-20')!.id)
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
    // 9/15 起每 2 天:今天之後是 19、21、23;20 是舊規則下已完成的
    assert.deepEqual(dates(rule.id), [
      '2026-09-15',
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
    assert.equal(getRule(rule.id).generatedThrough, END)
  })

  test('fills the lagging watermark with the old rule first', () => {
    const rule = insertRule(
      { title: 'old', startDate: '2026-09-01', generatedThrough: '2026-09-12' },
      ['old item'],
    )

    updateRule(rule.id, { title: 'new', checklist: ['new item'] }, TODAY)

    for (const date of range('2026-09-13', TODAY)) {
      const instance = instanceOn(rule.id, date)
      assert.ok(instance, `missing ${date}`)
      assert.equal(instance.title, 'old')
      assert.deepEqual(
        checklistOf(instance.id).map((item) => item.title),
        ['old item'],
      )
    }
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

    stopRule(rule.id, TODAY)

    assertPastAndCompletedUnchanged(rule.id, before, todayItemId)
    assert.deepEqual(dates(rule.id), [
      '2026-09-15',
      '2026-09-16',
      '2026-09-17',
      '2026-09-18',
      '2026-09-20',
    ])
    const stopped = getRule(rule.id)
    assert.notEqual(stopped.endedAt, null)

    fillInstances('2026-10-01')
    const second = stopRule(rule.id, TODAY)

    assert.deepEqual(second, stopped)
    assert.deepEqual(dates(rule.id), [
      '2026-09-15',
      '2026-09-16',
      '2026-09-17',
      '2026-09-18',
      '2026-09-20',
    ])
  })

  test('fills the lagging watermark before stopping', () => {
    const rule = insertRule({ startDate: '2026-09-01', generatedThrough: '2026-09-12' })

    stopRule(rule.id, TODAY)

    assert.deepEqual(dates(rule.id), range('2026-09-13', TODAY))
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

  function ruleCount(): number {
    return db.select().from(taskRecurrenceRule).all().length
  }

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
