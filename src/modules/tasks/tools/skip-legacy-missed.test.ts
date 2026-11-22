// 必須是第一個 import：在 db 連線建立前切到記憶體資料庫
import '../test/setup'
import assert from 'node:assert/strict'
import { before, beforeEach, describe, test } from 'node:test'
import { eq } from 'drizzle-orm'
import { applyMigrations, db } from '../db'
import {
  task,
  taskChecklistItem,
  taskRecurrenceRule,
  taskRecurrenceRuleChecklistItem,
} from '../db/schema'
import { skipLegacyMissedInstances } from './skip-legacy-missed'

before(() => {
  assert.equal(process.env.TASKS_DB_PATH, ':memory:')
  applyMigrations(db)
})

describe('skipLegacyMissedInstances', () => {
  const TODAY = '2026-09-20'

  beforeEach(() => {
    db.delete(taskChecklistItem).run()
    db.delete(task).run()
    db.delete(taskRecurrenceRuleChecklistItem).run()
    db.delete(taskRecurrenceRule).run()
  })

  function seedLegacy() {
    const [rule] = db
      .insert(taskRecurrenceRule)
      .values({
        freq: 'daily',
        interval: 1,
        weekdays: null,
        startDate: '2026-09-10',
        until: null,
        title: 'Water plants',
        notes: null,
        priority: 0,
        generatedThrough: '2026-09-26',
        endedAt: null,
        createdAt: 1000,
        updatedAt: 1000,
      })
      .returning()
      .all()

    const [untouchedMissed] = db
      .insert(task)
      .values({
        title: 'Water plants',
        notes: null,
        dueDate: '2026-09-18',
        priority: 0,
        completedAt: null,
        createdAt: 2000,
        recurrenceRuleId: rule.id,
        occurrenceDate: '2026-09-18',
        editedAt: 0,
      })
      .returning()
      .all()

    const [editedMissed] = db
      .insert(task)
      .values({
        title: 'Water plants',
        notes: 'added fertilizer',
        dueDate: '2026-09-19',
        priority: 0,
        completedAt: null,
        createdAt: 2000,
        recurrenceRuleId: rule.id,
        occurrenceDate: '2026-09-19',
        editedAt: 0,
      })
      .returning()
      .all()

    const [todayInstance] = db
      .insert(task)
      .values({
        title: 'Water plants',
        notes: null,
        dueDate: TODAY,
        priority: 0,
        completedAt: null,
        createdAt: 2000,
        recurrenceRuleId: rule.id,
        occurrenceDate: TODAY,
        editedAt: 0,
      })
      .returning()
      .all()

    return { rule, untouchedMissed, editedMissed, todayInstance }
  }

  test('dry-run lists only untouched legacy missed instances and leaves DB intact', () => {
    const { untouchedMissed, editedMissed, todayInstance } = seedLegacy()

    const listed = skipLegacyMissedInstances(TODAY, { apply: false })

    assert.deepEqual(
      listed.map((item) => item.id),
      [untouchedMissed.id],
    )
    const remaining = db.select({ id: task.id }).from(task).all().map((row) => row.id)
    assert.deepEqual(remaining, [untouchedMissed.id, editedMissed.id, todayInstance.id])
  })

  test('apply deletes only listed untouched instances and keeps edited ones with editedAt=0', () => {
    const { untouchedMissed, editedMissed, todayInstance } = seedLegacy()

    const deleted = skipLegacyMissedInstances(TODAY, { apply: true })

    assert.deepEqual(
      deleted.map((item) => item.id),
      [untouchedMissed.id],
    )
    const remaining = db
      .select({ id: task.id, editedAt: task.editedAt })
      .from(task)
      .all()
    assert.deepEqual(remaining, [
      { id: editedMissed.id, editedAt: 0 },
      { id: todayInstance.id, editedAt: 0 },
    ])
    assert.equal(db.select().from(task).where(eq(task.id, untouchedMissed.id)).all().length, 0)
  })
})
