// 必須是第一個 import:在 db 連線建立前切到記憶體資料庫
import '../test/setup'
import assert from 'node:assert/strict'
import { before, describe, test } from 'node:test'
import { asc, eq } from 'drizzle-orm'
import { applyMigrations, db } from '../db'
import { habitLog, habitPause, habitSettingsHistory } from '../db/schema'
import {
  addLog,
  createHabit,
  deleteHabit,
  listHabits,
  pauseHabit,
  removeLog,
  resumeHabit,
  setLogCount,
  updateHabit,
} from './habits'
import { ValidationError } from './errors'

const TODAY = '2026-09-19'

before(() => {
  // 保險:萬一 test/setup 沒先載入,不在真的資料庫上跑 migration 與寫入
  assert.equal(process.env.TASKS_DB_PATH, ':memory:')
  // 跑真正的 migration 檔,驗的是 SQL 裡的外鍵與索引,不是 schema 物件
  applyMigrations(db)
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

describe('setLogCount', () => {
  function countOn(habitId: number, date: string) {
    return logsOf(habitId).filter((log) => log.date === date)
  }

  test('fills up to N', () => {
    const { id } = createHabit({ name: 'x', periodType: 'daily', target: 4 }, TODAY)
    addLog(id, TODAY, TODAY)

    assert.deepEqual(setLogCount(id, TODAY, 3, TODAY), { date: TODAY, count: 3 })
    assert.equal(countOn(id, TODAY).length, 3)
  })

  test('removes down to N, newest first, leaving other dates alone', () => {
    const { id } = createHabit({ name: 'x', periodType: 'daily', target: 4 }, TODAY)
    const first = addLog(id, TODAY, TODAY)
    addLog(id, TODAY, TODAY)
    addLog(id, TODAY, TODAY)
    const other = addLog(id, '2026-09-18', TODAY)

    setLogCount(id, TODAY, 1, TODAY)

    assert.deepEqual(logsOf(id).map((log) => log.id), [first.id, other.id])
  })

  test('count 0 clears the date and is not an error', () => {
    const { id } = createHabit({ name: 'x', periodType: 'daily', target: 4 }, TODAY)
    addLog(id, TODAY, TODAY)
    addLog(id, TODAY, TODAY)

    assert.deepEqual(setLogCount(id, TODAY, 0, TODAY), { date: TODAY, count: 0 })
    assert.equal(countOn(id, TODAY).length, 0)
    // 已經是 0 再設 0 也不是錯誤
    assert.deepEqual(setLogCount(id, TODAY, 0, TODAY), { date: TODAY, count: 0 })
  })

  test('rejects a future date, a bad count, and writes while paused', () => {
    const { id } = createHabit({ name: 'x', periodType: 'daily', target: 4 }, TODAY)
    assertRejects(() => setLogCount(id, '2026-09-20', 1, TODAY), { date: 'invalid_value' })
    assertRejects(() => setLogCount(id, '2026-02-30', 1, TODAY), { date: 'invalid_format' })
    assertRejects(() => setLogCount(id, TODAY, -1, TODAY), { count: 'invalid_value' })
    assertRejects(() => setLogCount(id, TODAY, 1.5, TODAY), { count: 'invalid_value' })

    pauseHabit(id, TODAY)
    assertRejects(() => setLogCount(id, TODAY, 1, TODAY), { state: 'paused' })
    assert.equal(logsOf(id).length, 0)
  })
})

describe('listHabits periodCounts and totalLogs', () => {
  function summaryOf(id: number, today: string) {
    const summary = listHabits(today).find((habit) => habit.id === id)
    assert.ok(summary)
    return summary
  }

  test('only the current period, newest first; totalLogs counts everything', () => {
    // 2026-09-14 是星期一
    const { id } = createHabit({ name: 'w', periodType: 'weekly', target: 3 }, '2026-09-01')
    setLogCount(id, '2026-09-13', 2, TODAY)
    setLogCount(id, '2026-09-14', 1, TODAY)
    setLogCount(id, '2026-09-16', 2, TODAY)

    const summary = summaryOf(id, TODAY)
    assert.deepEqual(summary.periodCounts, [
      { date: '2026-09-16', count: 2 },
      { date: '2026-09-14', count: 1 },
    ])
    assert.equal(summary.totalLogs, 5)
  })

  test('once the period rolls over, the old period is gone from periodCounts', () => {
    const { id } = createHabit({ name: 'w', periodType: 'weekly', target: 3 }, '2026-09-01')
    // 週日記的,到下週一就屬於上一週
    setLogCount(id, '2026-09-20', 1, '2026-09-20')

    assert.deepEqual(summaryOf(id, '2026-09-20').periodCounts, [{ date: '2026-09-20', count: 1 }])
    assert.deepEqual(summaryOf(id, '2026-09-21').periodCounts, [])
  })

  test('undoing repeatedly walks back to earlier dates as each one reaches zero', () => {
    const { id } = createHabit({ name: 'w', periodType: 'weekly', target: 5 }, '2026-09-01')
    setLogCount(id, '2026-09-14', 2, TODAY)
    setLogCount(id, '2026-09-16', 1, TODAY)

    // 前端的退回:periodCounts 的第一筆減一
    function undo() {
      const [latest] = summaryOf(id, TODAY).periodCounts
      setLogCount(id, latest.date, latest.count - 1, TODAY)
    }

    undo()
    assert.deepEqual(summaryOf(id, TODAY).periodCounts, [{ date: '2026-09-14', count: 2 }])
    undo()
    assert.deepEqual(summaryOf(id, TODAY).periodCounts, [{ date: '2026-09-14', count: 1 }])
    undo()
    assert.deepEqual(summaryOf(id, TODAY).periodCounts, [])
  })
})
