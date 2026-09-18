// 重複規則的日期展開。純函式,前後端共用(之後前端虛擬展開同一份),不碰資料庫。
//
// 日期運算只用年月日整數與 UTC 午夜的 Date:
//   - 「天序號」= UTC 午夜的毫秒 / 86400000,一定是整數,沒有日光節約時間的 23/25 小時
//   - 不用 date.ts 的本地建構子,也不拿本地時間的 Date 加減毫秒
// 規則只依日曆計算,與「上一次什麼時候完成」無關。

import { formatIso, parseIso } from './date'

export const FREQS = ['daily', 'weekly', 'monthly', 'yearly'] as const

export type Freq = (typeof FREQS)[number]

export type RecurrenceSpec = {
  freq: Freq
  interval: number
  // bitmask,bit 0 = 星期一 … bit 6 = 星期日;只有 weekly 使用,其他為 null
  weekdays: number | null
  // 日曆日,YYYY-MM-DD;展開的錨點,早於它的日期一律不出現
  startDate: string
}

const MS_PER_DAY = 86400000

function dayNumber(iso: string): number {
  const { year, month, day } = parseIso(iso)
  return Date.UTC(year, month - 1, day) / MS_PER_DAY
}

function fromDayNumber(n: number): string {
  const date = new Date(n * MS_PER_DAY)
  return formatIso({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  })
}

// 0 = 星期一 … 6 = 星期日,對上 weekdays 的 bit 位置
function weekdayIndex(n: number): number {
  return (new Date(n * MS_PER_DAY).getUTCDay() + 6) % 7
}

function daysInMonth(year: number, month: number): number {
  // 下個月的第 0 天 = 這個月的最後一天
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function addDaysUtc(iso: string, days: number): string {
  return fromDayNumber(dayNumber(iso) + days)
}

// [from, to] 內所有符合規則、且 >= startDate 的日期,由小到大
export function expandRule(rule: RecurrenceSpec, from: string, to: string): string[] {
  const lower = from > rule.startDate ? from : rule.startDate
  if (lower > to) {
    return []
  }

  switch (rule.freq) {
    case 'daily':
      return expandDaily(rule, lower, to)
    case 'weekly':
      return expandWeekly(rule, lower, to)
    case 'monthly':
      return expandMonthly(rule, lower, to)
    case 'yearly':
      return expandYearly(rule, lower, to)
  }
}

function expandDaily(rule: RecurrenceSpec, lower: string, to: string): string[] {
  const start = dayNumber(rule.startDate)
  const dates: string[] = []
  for (let n = dayNumber(lower); n <= dayNumber(to); n += 1) {
    if ((n - start) % rule.interval === 0) {
      dates.push(fromDayNumber(n))
    }
  }
  return dates
}

// 週的間隔以「該日所在週的星期一」計算,所以 startDate 那一週裡早於它的星期幾不會出現,
// 晚於它的會出現
function expandWeekly(rule: RecurrenceSpec, lower: string, to: string): string[] {
  const weekdays = rule.weekdays ?? 0
  const start = dayNumber(rule.startDate)
  const startMonday = start - weekdayIndex(start)
  const dates: string[] = []
  for (let n = dayNumber(lower); n <= dayNumber(to); n += 1) {
    const index = weekdayIndex(n)
    const weeks = (n - index - startMonday) / 7
    if ((weekdays & (1 << index)) !== 0 && weeks % rule.interval === 0) {
      dates.push(fromDayNumber(n))
    }
  }
  return dates
}

// 每個月都從 startDate 的日重新計算,沒有那天就取月底;不從上一次的結果推算,
// 否則 1/31 → 2/28 之後會一路變成 28 號
function expandMonthly(rule: RecurrenceSpec, lower: string, to: string): string[] {
  const start = parseIso(rule.startDate)
  const first = parseIso(lower)
  const last = parseIso(to)
  const startIndex = start.year * 12 + (start.month - 1)
  const dates: string[] = []
  for (let m = first.year * 12 + (first.month - 1); m <= last.year * 12 + (last.month - 1); m += 1) {
    if ((m - startIndex) % rule.interval !== 0) {
      continue
    }
    const year = Math.floor(m / 12)
    const month = (m % 12) + 1
    const iso = formatIso({ year, month, day: Math.min(start.day, daysInMonth(year, month)) })
    if (iso >= lower && iso <= to) {
      dates.push(iso)
    }
  }
  return dates
}

// 月日取 startDate 的;2/29 在非閏年取 2/28
function expandYearly(rule: RecurrenceSpec, lower: string, to: string): string[] {
  const start = parseIso(rule.startDate)
  const dates: string[] = []
  for (let year = parseIso(lower).year; year <= parseIso(to).year; year += 1) {
    if ((year - start.year) % rule.interval !== 0) {
      continue
    }
    const day = Math.min(start.day, daysInMonth(year, start.month))
    const iso = formatIso({ year, month: start.month, day })
    if (iso >= lower && iso <= to) {
      dates.push(iso)
    }
  }
  return dates
}

// startDate 當天或之後的第一個日期。daily / monthly / yearly 一定是 startDate 本身;
// weekly 最遲在 interval 週之後,所以查 interval + 1 週一定找得到(weekdays 至少一個 bit)
export function firstOccurrence(rule: RecurrenceSpec): string {
  const [first] = expandRule(
    rule,
    rule.startDate,
    addDaysUtc(rule.startDate, (rule.interval + 1) * 7),
  )
  return first
}
