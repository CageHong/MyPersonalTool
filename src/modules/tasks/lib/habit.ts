// 習慣的週期、進度與 streak。純函式,前後端共用,不碰資料庫。
// 日期一律是 YYYY-MM-DD 字串,運算用 date.ts(本地建構子,只當日曆計算器)。
// 用到「今天」的函式都以參數接收 today,不在這裡讀時鐘。

import { addDays, formatIso, parseIso, WEEK_START, weekday } from './date'

export const PERIOD_TYPES = ['daily', 'weekly', 'monthly'] as const

export type PeriodType = (typeof PERIOD_TYPES)[number]

export type HabitSettings = {
  periodType: PeriodType
  // null = 紀錄型:只記錄,不判定達成
  target: number | null
}

export type HabitSettingsEntry = HabitSettings & {
  // 同一天多筆時 id 大的較新
  id: number
  effectiveFrom: string
}

export type HabitLogEntry = { date: string }

export type HabitPauseEntry = {
  startDate: string
  // null = 仍在停止中
  endDate: string | null
}

export type HabitProgress = {
  count: number
  target: number | null
  // target 為 null 時是 null,不是 false:紀錄型沒有「未達成」
  achieved: boolean | null
}

// 週期起始日:daily = 當天,weekly = 該週第一天(WEEK_START),monthly = 該月 1 日
export function periodStart(date: string, periodType: PeriodType): string {
  if (periodType === 'daily') {
    return date
  }
  if (periodType === 'weekly') {
    return addDays(date, -((weekday(date) - WEEK_START + 7) % 7))
  }
  const { year, month } = parseIso(date)
  return formatIso({ year, month, day: 1 })
}

// 週期最後一天:下一個週期的起始日前一天
export function periodEnd(start: string, periodType: PeriodType): string {
  if (periodType === 'daily') {
    return start
  }
  if (periodType === 'weekly') {
    return addDays(start, 6)
  }
  const { year, month } = parseIso(start)
  // 下個月的第 0 天 = 這個月的最後一天
  const lastDay = new Date(year, month, 0).getDate()
  return formatIso({ year, month, day: lastDay })
}

function previousPeriodStart(start: string, periodType: PeriodType): string {
  return periodStart(addDays(start, -1), periodType)
}

// 較新的在後:effectiveFrom 升冪,同一天比 id
function compareEntries(a: HabitSettingsEntry, b: HabitSettingsEntry): number {
  if (a.effectiveFrom !== b.effectiveFrom) {
    return a.effectiveFrom < b.effectiveFrom ? -1 : 1
  }
  return a.id - b.id
}

// date 當天生效的設定:effectiveFrom <= date 中最新的一筆;比建立日還早時回 null
export function settingsAt(history: HabitSettingsEntry[], date: string): HabitSettings | null {
  let found: HabitSettingsEntry | null = null
  for (const entry of history) {
    if (entry.effectiveFrom <= date && (found === null || compareEntries(entry, found) > 0)) {
      found = entry
    }
  }
  return found === null ? null : { periodType: found.periodType, target: found.target }
}

// 某個週期的進度。count 不封頂:超額允許
export function progressOf(
  logs: HabitLogEntry[],
  habit: HabitSettings,
  periodStartDate: string,
): HabitProgress {
  const count = logs.filter((log) => periodStart(log.date, habit.periodType) === periodStartDate).length
  return {
    count,
    target: habit.target,
    achieved: habit.target === null ? null : count >= habit.target,
  }
}

export type StreakInput = {
  logs: HabitLogEntry[]
  settingsHistory: HabitSettingsEntry[]
  pauses: HabitPauseEntry[]
  today: string
  // 豁免的週期起始日,跳過方式同停止;之後用點數購買凍結時由呼叫端傳入
  exempt?: string[]
}

// 連續達成的週期數,單位跟著週期(每週習慣的 streak 是週數)。紀錄型回 null。
//
// 從 today 所屬週期往前走:
//   - 與任一停止區間有交集(不要求完全覆蓋)或被豁免的週期跳過,不計入也不中斷
//   - 每個週期用它最後一天(不超過 today)生效的 target 判定:當前週期因此等於現在的設定;
//     過去的週期用當時的設定,之後降低目標不會讓斷掉的 streak 接回來
//   - 當前週期未達成不算斷(還沒結束),已達成則計入
//   - 某期的 target 為 null(當時是紀錄型)→ 停止:紀錄型改成有目標後,streak 從那時起算
// 下限是目前週期類型那一段設定的第一筆:改週期後舊週期的紀錄不參與,只改目標不影響下限
export function streakOf({ logs, settingsHistory, pauses, today, exempt = [] }: StreakInput): number | null {
  const current = settingsAt(settingsHistory, today)
  if (current === null || current.target === null) {
    return null
  }
  const { periodType } = current

  // 從最新往回找,遇到 periodType 不同的那筆為止
  const sorted = settingsHistory.filter((entry) => entry.effectiveFrom <= today).sort(compareEntries)
  let lowerIndex = sorted.length - 1
  while (lowerIndex > 0 && sorted[lowerIndex - 1].periodType === periodType) {
    lowerIndex -= 1
  }
  const lowerBound = periodStart(sorted[lowerIndex].effectiveFrom, periodType)

  const counts = new Map<string, number>()
  for (const log of logs) {
    const start = periodStart(log.date, periodType)
    counts.set(start, (counts.get(start) ?? 0) + 1)
  }
  const exemptSet = new Set(exempt)

  let streak = 0
  let start = periodStart(today, periodType)
  let isCurrent = true
  while (start >= lowerBound) {
    const end = periodEnd(start, periodType)
    const skipped =
      exemptSet.has(start) ||
      pauses.some((pause) => pause.startDate <= end && (pause.endDate === null || pause.endDate >= start))
    if (!skipped) {
      const target = settingsAt(settingsHistory, end < today ? end : today)?.target ?? null
      if (target === null) {
        break
      }
      if ((counts.get(start) ?? 0) >= target) {
        streak += 1
      } else if (!isCurrent) {
        break
      }
    }
    isCurrent = false
    start = previousPeriodStart(start, periodType)
  }
  return streak
}
