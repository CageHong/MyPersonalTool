import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { formatListDate, formatListDay, monthDays, weekdayHeaders } from './date'

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
