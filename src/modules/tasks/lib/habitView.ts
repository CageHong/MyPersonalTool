// 習慣的畫面模型:API 回傳的型別、計數的樂觀更新、圈圈怎麼畫。純函式,不碰 DOM 與網路。
// 前端不 import src/modules/tasks/server/,型別在這裡自行宣告(同 tasks.ts);週期的計算用共用的 habit.ts

import type { PeriodType } from './habit'

export type PeriodCount = { date: string; count: number }

// GET /api/tasks/habits 的一筆;只列畫面用得到的欄位
export type HabitItem = {
  id: number
  name: string
  periodType: PeriodType
  // null = 紀錄型:只記次數,沒有達成、沒有 streak
  target: number | null
  paused: boolean
  excludeFromSummary?: boolean
  progress: { count: number; target: number | null; achieved: boolean | null }
  // 紀錄型為 null
  streak: number | null
  // 本週期內有紀錄的日期與筆數,日期新的在前
  periodCounts: PeriodCount[]
  // 全期的紀錄筆數
  totalLogs: number
}

export type HabitPatch = {
  name?: string
  periodType?: PeriodType
  target?: number | null
  excludeFromSummary?: boolean
}

export function countOf(periodCounts: PeriodCount[]): number {
  return periodCounts.reduce((sum, entry) => sum + entry.count, 0)
}

export type CountStep = {
  // 走完之後的本週期筆數;樂觀覆寫值就是它
  periodCounts: PeriodCount[]
  // 每個有變動的日期要送的絕對值(PUT …/logs?date=),同一個日期只送最終值
  writes: PeriodCount[]
}

// 從目前的筆數走 delta 步。+1 一律記在今天;-1 作用在本週期最近有紀錄的那天(第一筆),
// 那天歸零就從清單消失,下一步作用在再前一天。本週期沒有紀錄時不再往下退。
// 顯示與送出都用這裡的結果,不拿伺服器回來的舊值另外算,連按時兩者才不會分岔
export function stepCounts(periodCounts: PeriodCount[], today: string, delta: number): CountStep {
  const next = periodCounts.map((entry) => ({ ...entry }))
  const changed = new Map<string, number>()

  for (let step = 0; step < Math.abs(delta); step += 1) {
    if (delta > 0) {
      // 本週期的日期都 <= today,今天有紀錄的話一定是第一筆
      if (next[0]?.date === today) {
        next[0].count += 1
      } else {
        next.unshift({ date: today, count: 1 })
      }
      changed.set(today, next[0].count)
    } else {
      const latest = next[0]
      if (latest === undefined) {
        break
      }
      latest.count -= 1
      changed.set(latest.date, latest.count)
      if (latest.count === 0) {
        next.shift()
      }
    }
  }

  return {
    periodCounts: next,
    writes: [...changed.entries()].map(([date, count]) => ({ date, count })),
  }
}

// 圈圈只畫到這麼多顆;目標更大改成數字加 −/+
export const MAX_CIRCLES = 6
// 超額圈圈最多這麼多顆;再多改成 +N
export const MAX_OVERFLOW_CIRCLES = 3

// 深淺編碼的是已勾與未勾,不是位置:done 實心深色,next 空心明顯外框,pending 空心淡色
export type CircleState = 'done' | 'next' | 'pending'

// 可點的只有第 count+1 顆(+1)與第 count 顆(-1);其餘是 null,不可點
export type CircleDelta = 1 | -1 | null

export type CircleModel =
  | { mode: 'record'; count: number }
  | { mode: 'number'; count: number; target: number }
  | { mode: 'circles'; circles: { state: CircleState; delta: CircleDelta }[] }
  | {
      mode: 'full'
      // 大勾:沒有超額時點了退一步(= target-1,展開回圈圈);有超額時不可點,要從右邊一顆一顆退
      checkDelta: CircleDelta
      overflow: number
      // 超額不超過 MAX_OVERFLOW_CIRCLES 顆時畫外框圈圈,最後一顆可退;更多時畫 +N,點它退一步
      overflowAs: 'circles' | 'number'
      // 超額時圈圈右邊的 6/4;沒有超額是 null
      ratio: string | null
    }

export function circleModel(count: number, target: number | null): CircleModel {
  if (target === null) {
    return { mode: 'record', count }
  }
  if (target > MAX_CIRCLES) {
    return { mode: 'number', count, target }
  }
  if (count < target) {
    return {
      mode: 'circles',
      circles: Array.from({ length: target }, (_, index) => {
        const position = index + 1
        const state: CircleState = position <= count ? 'done' : position === count + 1 ? 'next' : 'pending'
        const delta: CircleDelta = position === count + 1 ? 1 : position === count ? -1 : null
        return { state, delta }
      }),
    }
  }
  const overflow = count - target
  return {
    mode: 'full',
    checkDelta: overflow === 0 ? -1 : null,
    overflow,
    overflowAs: overflow > MAX_OVERFLOW_CIRCLES ? 'number' : 'circles',
    ratio: overflow > 0 ? `${count}/${target}` : null,
  }
}

const PERIOD_LABELS: Record<PeriodType, string> = {
  daily: '今天',
  weekly: '本週',
  monthly: '本月',
}

const STREAK_UNITS: Record<PeriodType, string> = {
  daily: '天',
  weekly: '週',
  monthly: '個月',
}

export const PERIOD_OPTIONS: { value: PeriodType; label: string }[] = [
  { value: 'daily', label: '每天' },
  { value: 'weekly', label: '每週' },
  { value: 'monthly', label: '每月' },
]

// 本週期的進度:「本週 2/4」;紀錄型「今天 3 次」
export function progressLabel(periodType: PeriodType, count: number, target: number | null): string {
  const period = PERIOD_LABELS[periodType]
  return target === null ? `${period} ${count} 次` : `${period} ${count}/${target}`
}

export function streakLabel(periodType: PeriodType, streak: number): string {
  return `連續 ${streak} ${STREAK_UNITS[periodType]}`
}

// 整排圈圈的 aria-label:名稱加目前次數與目標
export function countAriaLabel(name: string, periodType: PeriodType, count: number, target: number | null): string {
  const period = PERIOD_LABELS[periodType]
  return target === null ? `${name},${period} ${count} 次` : `${name},${period} ${count}/${target} 次`
}
