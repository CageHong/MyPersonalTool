// 必須是第一個 import:在 db 連線建立前切到記憶體資料庫
import '../test/setup'
import assert from 'node:assert/strict'
import { before, beforeEach, describe, test } from 'node:test'
import { asc, eq, sql } from 'drizzle-orm'
import { applyMigrations, db } from '../db'
import { task, taskChecklistItem, taskRecurrenceRule, taskReminder } from '../db/schema'
import {
  createChecklistItem,
  deleteChecklistItem,
  listChecklistItems,
  reorderChecklistItems,
  updateChecklistItem,
} from './checklist'
import { NotFoundError } from './errors'
import { createRuleFromTask, fillInstances, stopRule, updateRule } from './recurrence'
import { createReminder, listReminders } from './reminders'
import { createTask, deleteTask, listTasks, updateTask } from './tasks'
import { emptyTrash, listTrash, purgeTask, restoreTask } from './trash'

// 規格:docs/tasks/decisions.md §6h「垃圾桶這一輪」

const TODAY = '2026-09-18'

function at(date: string, time: string): Date {
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  return new Date(year, month - 1, day, hour, minute)
}

const NOW = at(TODAY, '10:00')

before(() => {
  // 保險:萬一 test/setup 沒先載入,不在真的資料庫上跑 migration 與寫入
  assert.equal(process.env.TASKS_DB_PATH, ':memory:')
  applyMigrations(db)
})

beforeEach(() => {
  db.delete(taskReminder).run()
  db.delete(task).run()
  db.delete(taskRecurrenceRule).run()
})

function rowExists(id: number): boolean {
  return db.select({ id: task.id }).from(task).where(eq(task.id, id)).all().length === 1
}

// 用 SQL 讀 deleted_at:跟 schema 的欄位名綁在一起,不跟 Drizzle 的屬性名綁
function deletedAtOf(id: number): number | null {
  return db.get<{ deleted_at: number | null }>(sql`select deleted_at from task where id = ${id}`).deleted_at
}

function setDeletedAt(id: number, value: number) {
  db.run(sql`update task set deleted_at = ${value} where id = ${id}`)
}

function liveIds(): number[] {
  return listTasks({ today: TODAY }).map((row) => row.id)
}

function assertNotFound(fn: () => unknown) {
  assert.throws(fn, (error) => error instanceof NotFoundError)
}

describe('deleteTask moves a task to the trash', () => {
  test('the row stays with deletedAt set; listTasks leaves it out', () => {
    const kept = createTask({ title: 'kept' })
    const trashed = createTask({ title: 'trashed' })
    const before = Math.floor(Date.now() / 1000)

    deleteTask(trashed.id)

    assert.ok(rowExists(trashed.id))
    const deletedAt = deletedAtOf(trashed.id)
    assert.ok(deletedAt !== null && deletedAt >= before)
    assert.deepEqual(liveIds(), [kept.id])
  })

  test('a new task is not in the trash', () => {
    const { id } = createTask({ title: 'task' })
    assert.equal(deletedAtOf(id), null)
  })

  test('checklist items and reminders stay while the task is in the trash', () => {
    const t = createTask({ title: 'task', dueDate: '2026-09-20' })
    createChecklistItem(t.id, 'item')
    createReminder({ taskId: t.id }, { kind: 'relative', daysBefore: 0, time: '09:00' }, NOW)

    deleteTask(t.id)

    assert.equal(db.select().from(taskChecklistItem).where(eq(taskChecklistItem.taskId, t.id)).all().length, 1)
    assert.equal(db.select().from(taskReminder).where(eq(taskReminder.taskId, t.id)).all().length, 1)
  })

  test('deleting a task already in the trash, or an unknown id, throws NotFoundError', () => {
    const { id } = createTask({ title: 'task' })
    deleteTask(id)

    assertNotFound(() => deleteTask(id))
    assertNotFound(() => deleteTask(999_999))
  })
})

describe('listTrash', () => {
  test('lists only trashed tasks, most recently deleted first, ties broken by id descending', () => {
    createTask({ title: 'live' })
    const a = createTask({ title: 'a' })
    const b = createTask({ title: 'b' })
    const c = createTask({ title: 'c' })
    for (const t of [a, b, c]) {
      deleteTask(t.id)
    }
    setDeletedAt(a.id, 2_000)
    setDeletedAt(b.id, 1_000)
    setDeletedAt(c.id, 2_000)

    assert.deepEqual(
      listTrash().map((row) => row.id),
      [c.id, a.id, b.id],
    )
  })

  test('each row carries deletedAt', () => {
    const t = createTask({ title: 'task' })
    deleteTask(t.id)
    setDeletedAt(t.id, 1_234)

    assert.equal(listTrash()[0].deletedAt, 1_234)
  })

  test('live tasks carry deletedAt null', () => {
    createTask({ title: 'task' })
    assert.equal(listTasks({ today: TODAY })[0].deletedAt, null)
  })
})

describe('restoreTask', () => {
  test('brings the task back with the same id, checklist and reminders', () => {
    const t = createTask({ title: 'task', dueDate: '2026-09-20' })
    createChecklistItem(t.id, 'item')
    createReminder({ taskId: t.id }, { kind: 'relative', daysBefore: 0, time: '09:00' }, NOW)
    deleteTask(t.id)

    const restored = restoreTask(t.id)

    assert.equal(restored.id, t.id)
    assert.equal(restored.deletedAt, null)
    assert.equal(deletedAtOf(t.id), null)
    assert.deepEqual(liveIds(), [t.id])
    assert.deepEqual(listTrash(), [])
    assert.equal(listChecklistItems(t.id).length, 1)
    assert.equal(listReminders({ taskId: t.id }).length, 1)
  })

  test('keeps the other fields as they were', () => {
    const t = createTask({ title: 'task', dueDate: '2026-09-20', priority: 5 })
    updateTask(t.id, { done: true })
    const beforeDelete = listTasks({ today: TODAY }).find((row) => row.id === t.id)!
    deleteTask(t.id)

    assert.deepEqual(restoreTask(t.id), beforeDelete)
  })

  test('a live task or an unknown id throws NotFoundError', () => {
    const { id } = createTask({ title: 'task' })
    assertNotFound(() => restoreTask(id))
    assertNotFound(() => restoreTask(999_999))
  })
})

describe('purgeTask', () => {
  test('deletes the row for good, with its checklist and reminders', () => {
    const t = createTask({ title: 'task', dueDate: '2026-09-20' })
    createChecklistItem(t.id, 'item')
    createReminder({ taskId: t.id }, { kind: 'relative', daysBefore: 0, time: '09:00' }, NOW)
    deleteTask(t.id)

    purgeTask(t.id)

    assert.equal(rowExists(t.id), false)
    assert.equal(db.select().from(taskChecklistItem).where(eq(taskChecklistItem.taskId, t.id)).all().length, 0)
    assert.equal(db.select().from(taskReminder).where(eq(taskReminder.taskId, t.id)).all().length, 0)
  })

  test('only works on a task in the trash: a live task or an unknown id throws NotFoundError', () => {
    const { id } = createTask({ title: 'task' })
    assertNotFound(() => purgeTask(id))
    assert.ok(rowExists(id))
    assertNotFound(() => purgeTask(999_999))
  })
})

describe('emptyTrash', () => {
  test('purges every trashed task and returns how many; live tasks stay', () => {
    const live = createTask({ title: 'live' })
    const a = createTask({ title: 'a' })
    const b = createTask({ title: 'b' })
    createChecklistItem(a.id, 'item')
    deleteTask(a.id)
    deleteTask(b.id)

    assert.equal(emptyTrash(), 2)

    assert.deepEqual(liveIds(), [live.id])
    assert.equal(rowExists(a.id), false)
    assert.equal(rowExists(b.id), false)
    assert.equal(db.select().from(taskChecklistItem).where(eq(taskChecklistItem.taskId, a.id)).all().length, 0)
  })

  test('an empty trash returns 0', () => {
    assert.equal(emptyTrash(), 0)
  })
})

describe('a task in the trash is read-only', () => {
  function trashedWithItem() {
    const t = createTask({ title: 'task', dueDate: '2026-09-20' })
    const item = createChecklistItem(t.id, 'item')
    deleteTask(t.id)
    return { taskId: t.id, itemId: item.id }
  }

  test('updateTask throws NotFoundError and writes nothing', () => {
    const { taskId } = trashedWithItem()
    assertNotFound(() => updateTask(taskId, { title: 'changed' }))
    assertNotFound(() => updateTask(taskId, { done: true }))
    assert.equal(listTrash()[0].title, 'task')
    assert.equal(listTrash()[0].completedAt, null)
  })

  test('checklist writes throw NotFoundError; reading the checklist still works', () => {
    const { taskId, itemId } = trashedWithItem()
    assertNotFound(() => createChecklistItem(taskId, 'new'))
    assertNotFound(() => updateChecklistItem(itemId, { title: 'changed' }))
    assertNotFound(() => deleteChecklistItem(itemId))
    assertNotFound(() => reorderChecklistItems(taskId, [itemId]))
    assert.deepEqual(
      listChecklistItems(taskId).map((item) => item.title),
      ['item'],
    )
  })

  test('adding a reminder throws NotFoundError', () => {
    const { taskId } = trashedWithItem()
    assertNotFound(() =>
      createReminder({ taskId }, { kind: 'relative', daysBefore: 0, time: '09:00' }, NOW),
    )
  })

  test('turning it into a recurrence rule throws NotFoundError', () => {
    const { taskId } = trashedWithItem()
    assertNotFound(() =>
      createRuleFromTask(taskId, { freq: 'daily', interval: 1, startDate: '2026-09-20' }, TODAY),
    )
  })
})

describe('recurring instances in the trash', () => {
  function instances(ruleId: number) {
    return db
      .select()
      .from(task)
      .where(eq(task.recurrenceRuleId, ruleId))
      .orderBy(asc(task.occurrenceDate))
      .all()
  }

  function instanceOn(ruleId: number, date: string) {
    return instances(ruleId).find((row) => row.occurrenceDate === date)
  }

  function dailyRuleFrom(startDate: string, filledOn: string) {
    const source = createTask({ title: 'rule', dueDate: startDate })
    const rule = createRuleFromTask(source.id, { freq: 'daily', interval: 1, startDate }, filledOn)
    fillInstances(filledOn)
    return rule
  }

  test('trashing an instance skips that day: it is not regenerated, and restoring brings it back', () => {
    const rule = dailyRuleFrom(TODAY, TODAY)
    const skipped = instanceOn(rule.id, '2026-09-20')!
    deleteTask(skipped.id)

    fillInstances(TODAY)
    fillInstances('2026-09-19')

    // 9/20 只有原本那一列(在垃圾桶裡),沒有新產生的
    assert.deepEqual(
      instances(rule.id).filter((row) => row.occurrenceDate === '2026-09-20').map((row) => row.id),
      [skipped.id],
    )
    assert.ok(!listTasks({ today: '2026-09-19' }).some((row) => row.id === skipped.id))

    restoreTask(skipped.id)
    assert.ok(listTasks({ today: '2026-09-19' }).some((row) => row.id === skipped.id))
  })

  test('a schedule change removes trashed future instances too, so the new rule can use those dates', () => {
    const rule = dailyRuleFrom(TODAY, TODAY)
    const trashed = instanceOn(rule.id, '2026-09-20')!
    deleteTask(trashed.id)

    // 每 2 天:18、20、22、24。9/20 要由新規則產生一筆在帳面上的實例
    updateRule(rule.id, { interval: 2 }, TODAY)

    assert.equal(rowExists(trashed.id), false)
    const fresh = instanceOn(rule.id, '2026-09-20')
    assert.ok(fresh && fresh.id !== trashed.id)
    assert.equal(deletedAtOf(fresh.id), null)
  })

  test('stopping a rule removes trashed future instances like the other future incomplete ones', () => {
    const rule = dailyRuleFrom(TODAY, TODAY)
    const trashed = instanceOn(rule.id, '2026-09-20')!
    deleteTask(trashed.id)

    stopRule(rule.id, TODAY)

    assert.equal(rowExists(trashed.id), false)
  })

  test('skipping missed instances leaves trashed ones in the trash', () => {
    const rule = dailyRuleFrom('2026-09-15', '2026-09-15')
    const trashed = instanceOn(rule.id, '2026-09-16')!
    const untouched = instanceOn(rule.id, '2026-09-17')!
    deleteTask(trashed.id)

    fillInstances(TODAY)

    // 沒動過的錯過實例照 §6a 被跳過;垃圾桶裡的只由使用者清
    assert.equal(rowExists(untouched.id), false)
    assert.ok(rowExists(trashed.id))
    assert.ok(listTrash().some((row) => row.id === trashed.id))
  })
})
