// 必須是第一個 import:在 db 連線建立前切到記憶體資料庫
import '../test/setup'
import assert from 'node:assert/strict'
import { before, describe, test } from 'node:test'
import { asc, eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { db } from '../db'
import { habitLog, habitPause, habitSettingsHistory } from '../db/schema'
import {
  addLog,
  createHabit,
  deleteHabit,
  listHabits,
  pauseHabit,
  removeLog,
  resumeHabit,
  updateHabit,
} from './habits'
import { ValidationError } from './errors'

const TODAY = '2026-09-19'

before(() => {
  // 保險:萬一 test/setup 沒先載入,不在真的資料庫上跑 migration 與寫入
  assert.equal(process.env.TASKS_DB_PATH, ':memory:')
  // 跑真正的 migration 檔,驗的是 SQL 裡的外鍵與索引,不是 schema 物件
  migrate(db, { migrationsFolder: './drizzle' })
})

function logsOf(habitId: number) {
  return db.select().from(habitLog).where(eq(habitLog.habitId, habitId)).orderBy(asc(habitLog.id)).all()
}

function historyOf(habitId: number) {
  return db
    .select()
    .from(habitSettingsHistory)
    .where(eq(habitSettingsHistory.habitId, habitId))
    .orderBy(asc(habitSettingsHistory.id))
    .all()
}

function assertRejects(fn: () => unknown, fields: Record<string, string>) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof ValidationError)
    assert.deepEqual(error.fields, fields)
    return true
  })
}

describe('createHabit', () => {
  test('writes the first settings history entry', () => {
    const created = createHabit({ name: ' 健身 ', periodType: 'weekly', target: 2 }, TODAY)

    assert.equal(created.name, '健身')
    assert.deepEqual(
      historyOf(created.id).map(({ periodType, target, effectiveFrom }) => ({ periodType, target, effectiveFrom })),
      [{ periodType: 'weekly', target: 2, effectiveFrom: TODAY }],
    )
  })

  test('rejects invalid input', () => {
    assertRejects(() => createHabit({ name: ' ', periodType: 'yearly' as 'daily', target: 0 }, TODAY), {
      name: 'required',
      periodType: 'invalid_value',
      target: 'invalid_value',
    })
  })
})

describe('updateHabit', () => {
  test('changing target or period type appends a full history entry', () => {
    const { id } = createHabit({ name: 'read', periodType: 'daily', target: 1 }, '2026-09-01')

    updateHabit(id, { target: 2 }, '2026-09-10')
    const updated = updateHabit(id, { periodType: 'weekly' }, TODAY)

    assert.equal(updated.periodType, 'weekly')
    assert.equal(updated.target, 2)
    assert.deepEqual(
      historyOf(id).map(({ periodType, target, effectiveFrom }) => [periodType, target, effectiveFrom]),
      [
        ['daily', 1, '2026-09-01'],
        ['daily', 2, '2026-09-10'],
        ['weekly', 2, TODAY],
      ],
    )
  })

  test('no actual change and name-only changes do not touch history', () => {
    const { id } = createHabit({ name: 'read', periodType: 'daily', target: 1 }, TODAY)

    updateHabit(id, { name: ' read ', periodType: 'daily', target: 1 }, TODAY)
    updateHabit(id, { name: 'read more' }, TODAY)

    assert.equal(historyOf(id).length, 1)
  })
})

describe('deleteHabit', () => {
  test('cascades to logs, history and pauses', () => {
    const { id } = createHabit({ name: 'x', periodType: 'daily', target: 1 }, TODAY)
    addLog(id, TODAY, TODAY)
    pauseHabit(id, TODAY)

    deleteHabit(id)

    assert.equal(logsOf(id).length, 0)
    assert.equal(historyOf(id).length, 0)
    assert.equal(db.select().from(habitPause).where(eq(habitPause.habitId, id)).all().length, 0)
  })
})

describe('addLog', () => {
  test('backfilling a past date is allowed', () => {
    const { id } = createHabit({ name: 'x', periodType: 'daily', target: 1 }, TODAY)

    addLog(id, '2026-09-10', TODAY)

    assert.deepEqual(logsOf(id).map((log) => log.date), ['2026-09-10'])
  })

  test('rejects a malformed or nonexistent date', () => {
    const { id } = createHabit({ name: 'x', periodType: 'daily', target: 1 }, TODAY)
    assertRejects(() => addLog(id, '2026-9-1', TODAY), { date: 'invalid_format' })
    assertRejects(() => addLog(id, '2026-02-30', TODAY), { date: 'invalid_format' })
  })

  test('rejects a future date', () => {
    const { id } = createHabit({ name: 'x', periodType: 'daily', target: 1 }, TODAY)
    assertRejects(() => addLog(id, '2026-09-20', TODAY), { date: 'invalid_value' })
    assert.equal(logsOf(id).length, 0)
  })

  test('rejects while paused', () => {
    const { id } = createHabit({ name: 'x', periodType: 'daily', target: 1 }, TODAY)
    pauseHabit(id, TODAY)
    assertRejects(() => addLog(id, TODAY, TODAY), { state: 'paused' })
    assert.equal(logsOf(id).length, 0)
  })
})

describe('removeLog', () => {
  test('removes the latest row of that date', () => {
    const { id } = createHabit({ name: 'x', periodType: 'daily', target: 1 }, TODAY)
    const first = addLog(id, TODAY, TODAY)
    addLog(id, TODAY, TODAY)
    const other = addLog(id, '2026-09-18', TODAY)

    removeLog(id, TODAY)

    assert.deepEqual(logsOf(id).map((log) => log.id), [first.id, other.id])
  })

  test('rejects when there is no log on that date', () => {
    const { id } = createHabit({ name: 'x', periodType: 'daily', target: 1 }, TODAY)
    addLog(id, '2026-09-18', TODAY)
    assertRejects(() => removeLog(id, TODAY), { date: 'no_log' })
  })
})

describe('pauseHabit / resumeHabit', () => {
  test('pausing twice is rejected', () => {
    const { id } = createHabit({ name: 'x', periodType: 'daily', target: 1 }, TODAY)
    pauseHabit(id, TODAY)
    assertRejects(() => pauseHabit(id, TODAY), { state: 'already_paused' })
  })

  test('resuming when not paused is rejected, including a second resume', () => {
    const { id } = createHabit({ name: 'x', periodType: 'daily', target: 1 }, TODAY)
    assertRejects(() => resumeHabit(id, TODAY), { state: 'not_paused' })

    pauseHabit(id, '2026-09-10')
    const resumed = resumeHabit(id, TODAY)
    assert.deepEqual([resumed.startDate, resumed.endDate], ['2026-09-10', TODAY])
    assertRejects(() => resumeHabit(id, TODAY), { state: 'not_paused' })
  })

  test('the partial unique index allows only one open pause', () => {
    const { id } = createHabit({ name: 'x', periodType: 'daily', target: 1 }, TODAY)
    pauseHabit(id, TODAY)
    assert.throws(() => db.insert(habitPause).values({ habitId: id, startDate: TODAY, endDate: null }).run())
  })
})

describe('listHabits', () => {
  test('returns progress, streak and paused state', () => {
    const { id } = createHabit({ name: 'list me', periodType: 'daily', target: 1 }, '2026-09-17')
    addLog(id, '2026-09-17', TODAY)
    addLog(id, '2026-09-18', TODAY)

    const summary = listHabits(TODAY).find((habit) => habit.id === id)

    assert.ok(summary)
    assert.equal(summary.paused, false)
    assert.equal(summary.periodStart, TODAY)
    assert.deepEqual(summary.progress, { count: 0, target: 1, achieved: false })
    assert.equal(summary.streak, 2)
  })
})
