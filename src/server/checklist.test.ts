// 必須是第一個 import:在 db 連線建立前切到記憶體資料庫
import '../test/setup'
import assert from 'node:assert/strict'
import { before, describe, test } from 'node:test'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { db } from '../db'
import { task, taskChecklistItem } from '../db/schema'
import {
  createChecklistItem,
  listChecklistItems,
  reorderChecklistItems,
  updateChecklistItem,
} from './checklist'
import { createTask, deleteTask, ValidationError } from './tasks'

before(() => {
  // 保險:萬一 test/setup 沒先載入,不在真的資料庫上跑 migration 與寫入
  assert.equal(process.env.TASKS_DB_PATH, ':memory:')
  // 跑真正的 migration 檔,驗的是 SQL 裡的外鍵設定,不是 schema 物件
  migrate(db, { migrationsFolder: './drizzle' })
})

function rowsForTask(taskId: number) {
  return db.select().from(taskChecklistItem).where(eq(taskChecklistItem.taskId, taskId)).all()
}

function setupTaskWithItems(count: number) {
  const created = createTask({ title: 'task' })
  const items = Array.from({ length: count }, (_, i) => createChecklistItem(created.id, `item ${i}`))
  return { taskId: created.id, ids: items.map((item) => item.id) }
}

describe('cascade', () => {
  test('deleting a task deletes its checklist items', () => {
    const { taskId } = setupTaskWithItems(2)
    assert.equal(rowsForTask(taskId).length, 2)

    deleteTask(taskId)

    assert.equal(rowsForTask(taskId).length, 0)
  })
})

describe('reorderChecklistItems', () => {
  test('rewrites positions in the given order', () => {
    const { taskId, ids } = setupTaskWithItems(3)
    const reversed = [...ids].reverse()

    reorderChecklistItems(taskId, reversed)

    assert.deepEqual(
      listChecklistItems(taskId).map((item) => item.id),
      reversed,
    )
  })

  const rejected: [string, (ids: number[], otherId: number) => number[]][] = [
    ['a missing id', (ids) => ids.slice(1)],
    ['an extra nonexistent id', (ids) => [...ids, 999_999]],
    ["another task's item id", (ids, otherId) => [...ids, otherId]],
    ['a duplicated id with the same length', (ids) => [ids[0], ids[0], ids[2]]],
  ]

  for (const [name, build] of rejected) {
    test(`rejects ${name} and leaves positions unchanged`, () => {
      const { taskId, ids } = setupTaskWithItems(3)
      const other = setupTaskWithItems(1)
      const before = listChecklistItems(taskId)

      assert.throws(() => reorderChecklistItems(taskId, build(ids, other.ids[0])), ValidationError)
      assert.deepEqual(listChecklistItems(taskId), before)
    })
  }
})

describe('updateChecklistItem done', () => {
  test('checking every item does not complete the task', () => {
    const { taskId, ids } = setupTaskWithItems(2)

    for (const id of ids) {
      updateChecklistItem(id, { done: true })
    }

    const [row] = db.select().from(task).where(eq(task.id, taskId)).all()
    assert.equal(row.completedAt, null)
  })

  test('done: false clears completedAt', () => {
    const { ids } = setupTaskWithItems(1)
    updateChecklistItem(ids[0], { done: true })

    const unchecked = updateChecklistItem(ids[0], { done: false })

    assert.equal(unchecked.completedAt, null)
  })

  test('done: true keeps an existing completedAt and updatedAt', () => {
    const { ids } = setupTaskWithItems(1)
    const old = 1_000_000
    db.update(taskChecklistItem)
      .set({ completedAt: old, updatedAt: old })
      .where(eq(taskChecklistItem.id, ids[0]))
      .run()

    const result = updateChecklistItem(ids[0], { done: true })

    assert.equal(result.completedAt, old)
    assert.equal(result.updatedAt, old)
  })
})
