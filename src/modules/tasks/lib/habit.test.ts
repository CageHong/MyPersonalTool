import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  periodStart,
  progressOf,
  settingsAt,
  streakOf,
  type HabitPauseEntry,
  type HabitSettingsEntry,
  type PeriodType,
} from './habit'

// 在有日光節約時間的時區跑,跨 DST 的週不能少一天。node --test 每個檔案一個 process,不影響其他檔
process.env.TZ = 'Europe/Berlin'

let nextId = 1
function setting(effectiveFrom: string, periodType: PeriodType, target: number | null): HabitSettingsEntry {
  return { id: nextId++, effectiveFrom, periodType, target }
}

function logsOn(...dates: string[]) {
  return dates.map((date) => ({ date }))
}

function streak(options: {
  logs: { date: string }[]
  history: HabitSettingsEntry[]
  today: string
  pauses?: HabitPauseEntry[]
  exempt?: string[]
}) {
  return streakOf({
    logs: options.logs,
    settingsHistory: options.history,
    pauses: options.pauses ?? [],
    today: options.today,
    exempt: options.exempt,
  })
}

describe('periodStart', () => {
  test('daily is the date itself', () => {
    assert.equal(periodStart('2026-09-19', 'daily'), '2026-09-19')
  })

  test('weekly goes back to Monday', () => {
    // 2026-09-14 是星期一
    assert.equal(periodStart('2026-09-14', 'weekly'), '2026-09-14')
    assert.equal(periodStart('2026-09-20', 'weekly'), '2026-09-14')
    assert.equal(periodStart('2026-09-21', 'weekly'), '2026-09-21')
  })

  test('weekly across a month and a year boundary', () => {
    // 2026-03-01 是星期日
    assert.equal(periodStart('2026-03-01', 'weekly'), '2026-02-23')
    // 2026-01-01 是星期四
    assert.equal(periodStart('2026-01-01', 'weekly'), '2025-12-29')
  })

  test('weekly across a DST change', () => {
    // 2026-03-29 歐洲夏令時間開始,是星期日
    assert.equal(periodStart('2026-03-29', 'weekly'), '2026-03-23')
    assert.equal(periodStart('2026-03-30', 'weekly'), '2026-03-30')
  })

  test('monthly is the first of the month', () => {
    assert.equal(periodStart('2026-09-19', 'monthly'), '2026-09-01')
    assert.equal(periodStart('2026-12-31', 'monthly'), '2026-12-01')
    assert.equal(periodStart('2027-01-01', 'monthly'), '2027-01-01')
  })
})

describe('settingsAt', () => {
  const history = [setting('2026-09-01', 'weekly', 3), setting('2026-09-16', 'weekly', 2)]

  test('picks the latest entry on or before the date', () => {
    assert.equal(settingsAt(history, '2026-09-15')?.target, 3)
    assert.equal(settingsAt(history, '2026-09-16')?.target, 2)
    assert.equal(settingsAt(history, '2026-10-01')?.target, 2)
  })

  test('returns null before the first entry', () => {
    assert.equal(settingsAt(history, '2026-08-31'), null)
  })

  test('on the same day the later entry wins, regardless of array order', () => {
    const sameDay = [setting('2026-09-16', 'weekly', 5), setting('2026-09-16', 'weekly', 4)]
    assert.equal(settingsAt([...sameDay].reverse(), '2026-09-16')?.target, 4)
  })
})

describe('progressOf', () => {
  const logs = logsOn('2026-09-13', '2026-09-14', '2026-09-16', '2026-09-16', '2026-09-19')

  test('counts logs in the period only', () => {
    assert.deepEqual(progressOf(logs, { periodType: 'weekly', target: 3 }, '2026-09-14'), {
      count: 4,
      target: 3,
      achieved: true,
    })
  })

  test('over-achievement is not capped', () => {
    const progress = progressOf(logs, { periodType: 'weekly', target: 2 }, '2026-09-14')
    assert.ok(progress.count > (progress.target as number))
  })

  test('record-only habits have achieved null', () => {
    assert.deepEqual(progressOf(logs, { periodType: 'daily', target: null }, '2026-09-16'), {
      count: 2,
      target: null,
      achieved: null,
    })
  })
})

describe('streakOf', () => {
  test('counts consecutive achieved periods', () => {
    const history = [setting('2026-09-01', 'daily', 1)]
    const logs = logsOn('2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19')
    assert.equal(streak({ logs, history, today: '2026-09-19' }), 4)
  })

  test('stops at the first missed past period', () => {
    const history = [setting('2026-09-01', 'daily', 1)]
    const logs = logsOn('2026-09-14', '2026-09-15', '2026-09-17', '2026-09-18', '2026-09-19')
    assert.equal(streak({ logs, history, today: '2026-09-19' }), 3)
  })

  test('the current period not yet achieved does not break the chain', () => {
    const history = [setting('2026-09-01', 'daily', 1)]
    const logs = logsOn('2026-09-17', '2026-09-18')
    assert.equal(streak({ logs, history, today: '2026-09-19' }), 2)
  })

  test('paused periods are skipped and the chain continues', () => {
    const history = [setting('2026-09-01', 'daily', 1)]
    const logs = logsOn('2026-09-14', '2026-09-15', '2026-09-18', '2026-09-19')
    const pauses = [{ startDate: '2026-09-16', endDate: '2026-09-17' }]
    assert.equal(streak({ logs, history, pauses, today: '2026-09-19' }), 4)
  })

  test('a pause that only partly overlaps a week still skips the week', () => {
    const history = [setting('2026-08-01', 'weekly', 2)]
    // 9/7 那週只做一次,但 9/12(週六)起停止到 9/13
    const logs = logsOn('2026-08-31', '2026-09-01', '2026-09-08', '2026-09-15', '2026-09-16')
    const pauses = [{ startDate: '2026-09-12', endDate: '2026-09-13' }]
    assert.equal(streak({ logs, history, pauses, today: '2026-09-19' }), 2)
  })

  test('an ongoing pause skips the current period', () => {
    const history = [setting('2026-09-01', 'daily', 1)]
    const logs = logsOn('2026-09-17')
    const pauses = [{ startDate: '2026-09-18', endDate: null }]
    assert.equal(streak({ logs, history, pauses, today: '2026-09-19' }), 1)
  })

  test('exempt periods are skipped like pauses', () => {
    const history = [setting('2026-09-01', 'daily', 1)]
    const logs = logsOn('2026-09-17', '2026-09-19')
    assert.equal(streak({ logs, history, today: '2026-09-19', exempt: ['2026-09-18'] }), 2)
  })

  test('stops at the period the habit was created in', () => {
    const history = [setting('2026-09-17', 'daily', 1)]
    // 建立前的補登不算
    const logs = logsOn('2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19')
    assert.equal(streak({ logs, history, today: '2026-09-19' }), 3)
  })

  test('record-only habits have no streak', () => {
    const history = [setting('2026-09-01', 'daily', null)]
    assert.equal(streak({ logs: logsOn('2026-09-19'), history, today: '2026-09-19' }), null)
  })

  test('changing the period type restarts the streak from the change', () => {
    // 每天做了兩週,9/16(週三)改成每週 1 次
    const history = [setting('2026-09-01', 'daily', 1), setting('2026-09-16', 'weekly', 1)]
    const logs = logsOn(...Array.from({ length: 19 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`))
    // 只有 9/14 那週;9/7、8/31 那週的每日紀錄不參與
    assert.equal(streak({ logs, history, today: '2026-09-19' }), 1)
  })

  test('changing only the target keeps the chain and judges history by the target then', () => {
    // 9/7 那週只做 2 次,當時目標 3 → 斷;9/16 降成 2 不會讓它接回來
    const history = [setting('2026-08-31', 'weekly', 3), setting('2026-09-16', 'weekly', 2)]
    const logs = logsOn(
      '2026-08-31', '2026-09-01', '2026-09-02',
      '2026-09-07', '2026-09-08',
      '2026-09-14', '2026-09-15',
    )
    assert.equal(streak({ logs, history, today: '2026-09-19' }), 1)

    // 目標沒變時 8/31 那週照當時的 3 次判定,改目標不重算下限
    const unchanged = [setting('2026-08-31', 'weekly', 3), setting('2026-09-16', 'weekly', 2)]
    const allMet = logsOn(
      '2026-08-31', '2026-09-01', '2026-09-02',
      '2026-09-07', '2026-09-08', '2026-09-09',
      '2026-09-14', '2026-09-15',
    )
    assert.equal(streak({ logs: allMet, history: unchanged, today: '2026-09-19' }), 3)
  })

  test('a record-only habit given a target counts only periods after the change', () => {
    const history = [setting('2026-09-01', 'daily', null), setting('2026-09-17', 'daily', 1)]
    const logs = logsOn('2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19')
    assert.equal(streak({ logs, history, today: '2026-09-19' }), 3)
  })
})
