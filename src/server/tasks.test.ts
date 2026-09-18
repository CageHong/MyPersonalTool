// 必須是第一個 import:在 db 連線建立前切到記憶體資料庫
import '../test/setup'
import assert from 'node:assert/strict'
import { before, describe, test } from 'node:test'
import { eq, sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { db } from '../db'
import { task } from '../db/schema'
import { createTask, NotFoundError, updateTask, ValidationError, type UpdateTaskPatch } from './tasks'

before(() => {
  // 保險:萬一 test/setup 沒先載入,不在真的資料庫上跑 migration 與寫入
  assert.equal(process.env.TASKS_DB_PATH, ':memory:')
  migrate(db, { migrationsFolder: './drizzle' })
})

// task 表沒有 updatedAt,改用連線累計的異動列數判斷「有沒有寫入」;讀取不會增加
function totalChanges(): number {
  return db.get<{ n: number }>(sql`select total_changes() as n`).n
}

function assertNoWrite<T>(fn: () => T): T {
  const before = totalChanges()
  const result = fn()
  assert.equal(totalChanges(), before)
  return result
}

function setCompletedAt(id: number, completedAt: number | null) {
  db.update(task).set({ completedAt }).where(eq(task.id, id)).run()
}

describe('updateTask done', () => {
  test('done: true on a completed task keeps the original completedAt', () => {
    // 秒級時間戳在同一秒內分不出新舊,先直接寫一個舊值
    const { id } = createTask({ title: 'task' })
    const old = 1_000_000
    setCompletedAt(id, old)

    const result = assertNoWrite(() => updateTask(id, { done: true }))

    assert.equal(result.completedAt, old)
  })

  test('done: false on an incomplete task does not write', () => {
    const { id } = createTask({ title: 'task' })

    const result = assertNoWrite(() => updateTask(id, { done: false }))

    assert.equal(result.completedAt, null)
  })

  test('done: true on an incomplete task writes the current time', () => {
    const { id } = createTask({ title: 'task' })
    const start = Math.floor(Date.now() / 1000)

    const result = updateTask(id, { done: true })

    assert.ok(result.completedAt !== null && result.completedAt >= start)
  })

  test('done: false on a completed task clears completedAt', () => {
    const { id } = createTask({ title: 'task' })
    setCompletedAt(id, 1_000_000)

    assert.equal(updateTask(id, { done: false }).completedAt, null)
  })
})

describe('updateTask unchanged values', () => {
  function setupFullTask() {
    return createTask({
      title: 'task',
      notes: 'notes',
      dueDate: '2026-09-10',
      dueTime: '15:00',
      scheduledAt: 1_000_000,
      durationMinutes: 30,
      priority: 3,
    })
  }

  const samePatches: [string, UpdateTaskPatch][] = [
    ['title (after trim)', { title: '  task  ' }],
    ['notes', { notes: 'notes' }],
    ['dueDate', { dueDate: '2026-09-10' }],
    ['dueTime', { dueTime: '15:00' }],
    ['scheduledAt', { scheduledAt: 1_000_000 }],
    ['durationMinutes', { durationMinutes: 30 }],
    ['priority', { priority: 3 }],
    ['parentTaskId', { parentTaskId: null }],
    [
      'every field at once',
      {
        title: 'task',
        notes: 'notes',
        dueDate: '2026-09-10',
        dueTime: '15:00',
        scheduledAt: 1_000_000,
        durationMinutes: 30,
        priority: 3,
        parentTaskId: null,
      },
    ],
  ]

  for (const [name, patch] of samePatches) {
    test(`same ${name} does not write`, () => {
      const created = setupFullTask()

      const result = assertNoWrite(() => updateTask(created.id, patch))

      assert.deepEqual(result, created)
    })
  }

  test('priority null counts as the same as 0', () => {
    const created = createTask({ title: 'task' })

    assertNoWrite(() => updateTask(created.id, { priority: null }))
  })

  test('unknown id still throws NotFoundError', () => {
    assert.throws(() => updateTask(999_999, {}), NotFoundError)
  })
})

describe('updateTask changed values', () => {
  const changedPatches: [string, UpdateTaskPatch][] = [
    ['title', { title: 'renamed' }],
    ['notes', { notes: 'other' }],
    ['dueDate', { dueDate: '2026-09-11' }],
    ['dueTime', { dueTime: '16:00' }],
    ['scheduledAt', { scheduledAt: 2_000_000 }],
    ['durationMinutes', { durationMinutes: 45 }],
    ['priority', { priority: 5 }],
  ]

  for (const [name, patch] of changedPatches) {
    test(`different ${name} is written`, () => {
      const { id } = createTask({ title: 'task', priority: 1 })
      const before = totalChanges()

      const result = updateTask(id, patch)

      assert.equal(totalChanges(), before + 1)
      assert.deepEqual({ ...result, ...patch }, result)
      const [row] = db.select().from(task).where(eq(task.id, id)).all()
      assert.deepEqual(row, result)
    })
  }

  test('mixed patch writes only the changed field', () => {
    const created = createTask({ title: 'task', notes: 'notes' })

    const result = updateTask(created.id, { title: 'task', notes: 'other' })

    assert.deepEqual(result, { ...created, notes: 'other' })
  })
})

describe('updateTask validation', () => {
  test('rejects completedAt', () => {
    const { id } = createTask({ title: 'task' })

    assert.throws(
      () => updateTask(id, { completedAt: 123 } as UpdateTaskPatch),
      (error) => error instanceof ValidationError && error.fields.completedAt === 'invalid_value',
    )
  })

  test('rejects a non-boolean done', () => {
    const { id } = createTask({ title: 'task' })

    assert.throws(
      () => updateTask(id, { done: 'yes' } as unknown as UpdateTaskPatch),
      (error) => error instanceof ValidationError && error.fields.done === 'invalid_value',
    )
  })
})
