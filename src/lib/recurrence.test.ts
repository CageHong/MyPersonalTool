import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { describeRule, expandRule, upcomingOccurrences, type RecurrenceSpec } from './recurrence'

// 在有日光節約時間的時區跑,DST 那項才有意義。node --test 每個檔案一個 process,不影響其他檔
process.env.TZ = 'Europe/Berlin'

const MONDAY = 1 << 0
const THURSDAY = 1 << 3

function rule(spec: Partial<RecurrenceSpec> & Pick<RecurrenceSpec, 'freq' | 'startDate'>): RecurrenceSpec {
  return { interval: 1, weekdays: null, ...spec }
}

describe('expandRule', () => {
  test('daily with interval 3', () => {
    const daily = rule({ freq: 'daily', interval: 3, startDate: '2026-09-01' })

    assert.deepEqual(expandRule(daily, '2026-09-01', '2026-09-10'), [
      '2026-09-01',
      '2026-09-04',
      '2026-09-07',
      '2026-09-10',
    ])
    // 從中間開始也對齊 startDate,不對齊 from
    assert.deepEqual(expandRule(daily, '2026-09-05', '2026-09-10'), ['2026-09-07', '2026-09-10'])
  })

  test('weekly every 2 weeks on Monday and Thursday, starting on a Wednesday', () => {
    // 2026-09-16 是星期三:該週的星期一在 startDate 之前,只剩星期四
    const weekly = rule({
      freq: 'weekly',
      interval: 2,
      weekdays: MONDAY | THURSDAY,
      startDate: '2026-09-16',
    })

    assert.deepEqual(expandRule(weekly, '2026-09-14', '2026-10-04'), [
      '2026-09-17',
      // 9/21 那週跳過
      '2026-09-28',
      '2026-10-01',
    ])
  })

  test('monthly on the 31st falls back to the last day of shorter months', () => {
    const monthly = rule({ freq: 'monthly', startDate: '2027-01-31' })

    assert.deepEqual(expandRule(monthly, '2027-02-01', '2027-04-30'), [
      '2027-02-28',
      // 每個月從 31 號重新算,不從 2/28 往後推
      '2027-03-31',
      '2027-04-30',
    ])
    assert.deepEqual(expandRule(monthly, '2028-02-01', '2028-02-29'), ['2028-02-29'])
  })

  test('yearly on Feb 29 uses Feb 28 in non-leap years', () => {
    const yearly = rule({ freq: 'yearly', startDate: '2028-02-29' })

    assert.deepEqual(expandRule(yearly, '2029-01-01', '2032-12-31'), [
      '2029-02-28',
      '2030-02-28',
      '2031-02-28',
      '2032-02-29',
    ])
  })

  test('a range entirely before startDate is empty', () => {
    for (const freq of ['daily', 'monthly', 'yearly'] as const) {
      assert.deepEqual(expandRule(rule({ freq, startDate: '2026-09-18' }), '2026-01-01', '2026-09-17'), [])
    }
    const weekly = rule({ freq: 'weekly', weekdays: 127, startDate: '2026-09-18' })
    assert.deepEqual(expandRule(weekly, '2026-01-01', '2026-09-17'), [])
  })

  test('daily across the 2026-10-25 DST change neither repeats nor skips', () => {
    // 確認真的在有 DST 的時區:這兩天的 UTC 偏移不同
    assert.notEqual(
      new Date(2026, 9, 24).getTimezoneOffset(),
      new Date(2026, 9, 26).getTimezoneOffset(),
    )
    const daily = rule({ freq: 'daily', startDate: '2026-10-01' })

    assert.deepEqual(expandRule(daily, '2026-10-23', '2026-10-28'), [
      '2026-10-23',
      '2026-10-24',
      '2026-10-25',
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
    ])
  })
})

describe('describeRule', () => {
  const cases: [string, RecurrenceSpec, string][] = [
    ['daily', rule({ freq: 'daily', startDate: '2026-09-18' }), '每天'],
    ['daily every 3', rule({ freq: 'daily', interval: 3, startDate: '2026-09-18' }), '每 3 天'],
    [
      'weekly Mon, Thu (Monday first regardless of bit order)',
      rule({ freq: 'weekly', weekdays: THURSDAY | MONDAY, startDate: '2026-09-18' }),
      '每週一、四',
    ],
    [
      'weekly every 2',
      rule({ freq: 'weekly', interval: 2, weekdays: MONDAY | THURSDAY, startDate: '2026-09-18' }),
      '每 2 週的週一、四',
    ],
    ['weekly Sunday last', rule({ freq: 'weekly', weekdays: (1 << 6) | MONDAY, startDate: '2026-09-18' }), '每週一、日'],
    ['monthly', rule({ freq: 'monthly', startDate: '2026-09-18' }), '每月 18 日'],
    ['monthly every 3', rule({ freq: 'monthly', interval: 3, startDate: '2026-09-18' }), '每 3 個月的 18 日'],
    ['monthly on 31', rule({ freq: 'monthly', startDate: '2026-08-31' }), '每月 31 日（該月沒有 31 日則取月底）'],
    ['monthly on 29', rule({ freq: 'monthly', startDate: '2026-01-29' }), '每月 29 日（該月沒有 29 日則取月底）'],
    ['monthly on 28 has no note', rule({ freq: 'monthly', startDate: '2026-01-28' }), '每月 28 日'],
    ['yearly', rule({ freq: 'yearly', startDate: '2026-09-18' }), '每年 9 月 18 日'],
    ['yearly every 2', rule({ freq: 'yearly', interval: 2, startDate: '2026-09-18' }), '每 2 年的 9 月 18 日'],
    ['yearly on Feb 29', rule({ freq: 'yearly', startDate: '2028-02-29' }), '每年 2 月 29 日（非閏年取 2 月 28 日）'],
  ]

  for (const [name, spec, expected] of cases) {
    test(name, () => {
      assert.equal(describeRule(spec), expected)
    })
  }
})

describe('upcomingOccurrences', () => {
  const TODAY = '2026-09-18'

  test('a Friday anchor set to every Monday starts next Monday', () => {
    // 2026-09-18 是星期五
    const weekly = rule({ freq: 'weekly', weekdays: MONDAY, startDate: TODAY })

    assert.deepEqual(upcomingOccurrences(weekly, TODAY, 4), [
      '2026-09-21',
      '2026-09-28',
      '2026-10-05',
      '2026-10-12',
    ])
  })

  test('an anchor 30 days ago does not backfill: [anchor, today, tomorrow, the day after]', () => {
    const daily = rule({ freq: 'daily', startDate: '2026-08-19' })

    assert.deepEqual(upcomingOccurrences(daily, TODAY, 4), [
      '2026-08-19',
      '2026-09-18',
      '2026-09-19',
      '2026-09-20',
    ])
  })

  test('monthly on the 31st', () => {
    const monthly = rule({ freq: 'monthly', startDate: '2026-10-31' })

    assert.deepEqual(upcomingOccurrences(monthly, TODAY, 4), [
      '2026-10-31',
      '2026-11-30',
      '2026-12-31',
      '2027-01-31',
    ])
  })

  test('a large interval still finds count dates', () => {
    const yearly = rule({ freq: 'yearly', interval: 99, startDate: TODAY })

    assert.deepEqual(upcomingOccurrences(yearly, TODAY, 4), [
      '2026-09-18',
      '2125-09-18',
      '2224-09-18',
      '2323-09-18',
    ])
  })
})
