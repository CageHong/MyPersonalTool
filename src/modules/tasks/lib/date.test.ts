import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  formatListDate,
  formatListDay,
  monthDays,
  msUntilNextLocalMidnight,
  weekdayHeaders,
} from './date'

describe('formatListDate', () => {
  // 2026-09-19 是週六:本週只剩明天(週日),9/21–9/27 是下週
  const SATURDAY = '2026-09-19'
  const cases: [string, string][] = [
    ['2026-09-18', '9.18'],
    ['2026-09-19', '9.19 今天'],
    ['2026-09-20', '9.20 明天'],
    ['2026-09-21', '9.21 下週一'],
    ['2026-09-27', '9.27 下週日'],
    ['2026-09-28', '9.28'],
    ['2027-01-05', '2027.1.5'],
  ]
  for (const [iso, expected] of cases) {
    test(`${iso} on Saturday → ${expected}`, () => {
      assert.equal(formatListDate(iso, SATURDAY), expected)
    })
  }

  // 2026-09-21 是週一:本週到 9/27,下週是 9/28–10/4
  const MONDAY = '2026-09-21'
  test('on Monday the rest of this week is 週X', () => {
    assert.equal(formatListDate('2026-09-23', MONDAY), '9.23 週三')
    assert.equal(formatListDate('2026-09-27', MONDAY), '9.27 週日')
  })

  test('on Monday next week starts the following Monday', () => {
    assert.equal(formatListDate('2026-09-28', MONDAY), '9.28 下週一')
    assert.equal(formatListDate('2026-10-05', MONDAY), '10.5')
  })

  test('on Sunday tomorrow is 明天 even though it is next Monday', () => {
    assert.equal(formatListDate('2026-09-21', '2026-09-20'), '9.21 明天')
    assert.equal(formatListDate('2026-09-22', '2026-09-20'), '9.22 下週二')
  })
})

describe('calendar starts on Monday', () => {
  test('headers run Monday to Sunday', () => {
    assert.deepEqual(weekdayHeaders(), ['一', '二', '三', '四', '五', '六', '日'])
  })

  test('2026-09-01 is a Tuesday, so one blank cell before it', () => {
    const cells = monthDays(2026, 9)
    assert.equal(cells[0], null)
    assert.equal(cells[1], '2026-09-01')
  })

  test('a month starting on Sunday has six blank cells', () => {
    // 2026-11-01 是週日
    const cells = monthDays(2026, 11)
    assert.equal(cells.indexOf('2026-11-01'), 6)
  })
})

describe('formatListDay', () => {
  test('omits the year within this year and adds it otherwise', () => {
    assert.equal(formatListDay('2026-09-23', '2026-09-19'), '9.23')
    assert.equal(formatListDay('2027-01-05', '2026-09-19'), '2027.1.5')
    assert.equal(formatListDay('2025-12-31', '2026-09-19'), '2025.12.31')
  })
})

describe('msUntilNextLocalMidnight', () => {
  test('returns milliseconds from an ordinary time of day to next midnight', () => {
    // 10:30 距離午夜 13.5 小時
    const now = new Date(2026, 8, 19, 10, 30, 0, 0)
    assert.equal(msUntilNextLocalMidnight(now), 13.5 * 3600 * 1000)
  })

  test('returns 1000ms at 23:59:59.000', () => {
    const now = new Date(2026, 8, 19, 23, 59, 59, 0)
    assert.equal(msUntilNextLocalMidnight(now), 1000)
  })

  test('accounts for daylight saving time transition day', () => {
    const previousTz = process.env.TZ
    process.env.TZ = 'Europe/Berlin'
    try {
      // 2026-03-29 夏令時間開始(02:00 → 03:00),整天只有 23 小時;01:00 距離午夜是 22 小時
      const dstStart = new Date(2026, 2, 29, 1, 0, 0, 0)
      assert.equal(msUntilNextLocalMidnight(dstStart), 22 * 3600 * 1000)
    } finally {
      if (previousTz === undefined) {
        delete process.env.TZ
      } else {
        process.env.TZ = previousTz
      }
    }
  })
})
