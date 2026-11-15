// 日曆日一律是 YYYY-MM-DD 字串。Date 只在「這個月幾天 / 星期幾 / 加天數」時當計算器用,
// 而且只用本地建構子與本地 getter:
//   - new Date('2026-09-11') 會被當成 UTC 午夜解析 → 不用
//   - toISOString() 會轉成 UTC → 不用
// 否則 UTC+13 或 UTC-11 的使用者會差一天。

export type DateParts = { year: number; month: number; day: number }

// 純字串切割,不經過 Date
export function parseIso(iso: string): DateParts {
  const [year, month, day] = iso.split('-').map(Number)
  return { year, month, day }
}

export function formatIso({ year, month, day }: DateParts): string {
  const mm = String(month).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  return `${year}-${mm}-${dd}`
}

function fromDate(date: Date): string {
  return formatIso({
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  })
}

export function todayIso(): string {
  return fromDate(new Date())
}

// 到下一個本地午夜的毫秒數
export function msUntilNextLocalMidnight(now: Date): number {
  const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  return nextMidnight.getTime() - now.getTime()
}

export function addDays(iso: string, days: number): string {
  const { year, month, day } = parseIso(iso)
  return fromDate(new Date(year, month - 1, day + days))
}

// 0 = 週日,6 = 週六
export function weekday(iso: string): number {
  const { year, month, day } = parseIso(iso)
  return new Date(year, month - 1, day).getDay()
}

// 最近的那個星期幾;iso 當天就是的話回自己
export function onOrNextWeekday(iso: string, target: number): string {
  return addDays(iso, (target - weekday(iso) + 7) % 7)
}

// 下一個那個星期幾;iso 當天就是的話跳到下一週
export function nextWeekday(iso: string, target: number): string {
  return addDays(iso, (target - weekday(iso) + 7) % 7 || 7)
}

export function addMonths({ year, month }: { year: number; month: number }, delta: number) {
  const date = new Date(year, month - 1 + delta, 1)
  return { year: date.getFullYear(), month: date.getMonth() + 1 }
}

// 月曆格子:前面補 null 讓 1 號落在正確的星期,後面是該月每一天
export function monthDays(year: number, month: number): (string | null)[] {
  // 月初前面補幾個空格:從一週的起始日算到 1 號是星期幾
  const firstWeekday = (new Date(year, month - 1, 1).getDay() - WEEK_START + 7) % 7
  // 下個月的第 0 天 = 這個月的最後一天
  const dayCount = new Date(year, month, 0).getDate()

  const cells: (string | null)[] = Array.from({ length: firstWeekday }, () => null)
  for (let day = 1; day <= dayCount; day += 1) {
    cells.push(formatIso({ year, month, day }))
  }
  return cells
}

// 以 getDay() 為索引(0 = 週日),不是畫面上的排列順序
export const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']

// 一週從哪一天開始,0 = 週日、1 = 週一(同 getDay())。月曆的欄位順序與「本週/下週」都由它決定;
// 之後做成使用者設定時只改這裡
export const WEEK_START = 1

// 月曆表頭:從 WEEK_START 起排的七天
export function weekdayHeaders(): string[] {
  return Array.from({ length: 7 }, (_, index) => WEEKDAY_LABELS[(WEEK_START + index) % 7])
}

// to 減 from 的天數;兩邊都用本地建構子,不經過 UTC
export function diffDays(from: string, to: string): number {
  const a = parseIso(from)
  const b = parseIso(to)
  const ms =
    new Date(b.year, b.month - 1, b.day).getTime() - new Date(a.year, a.month - 1, a.day).getTime()
  // 有日光節約時間的地區,一天可能是 23 或 25 小時,所以四捨五入
  return Math.round(ms / 86400000)
}

// ISO 字串的字典序就是時間序,直接比字串
export function isOverdue(iso: string, today: string = todayIso()): boolean {
  return iso < today
}

// 中欄任務列與截止日觸發鈕的日期:日期永遠顯示(M.D,不是今年才補年份),
// 今天到下週最後一天再加相對說法:今天、明天用專稱,本週內「週X」,下週「下週X」。
// 逾期與更遠的只有日期(逾期的顏色由呼叫端處理)
// formatListDate 的日期部分:M.D,不是今年才補年份。「原定 M.D」等只要日期的地方也用它
export function formatListDay(iso: string, today: string = todayIso()): string {
  const { year, month, day } = parseIso(iso)
  return year === parseIso(today).year ? `${month}.${day}` : `${year}.${month}.${day}`
}

export function formatListDate(iso: string, today: string = todayIso()): string {
  const date = formatListDay(iso, today)

  const days = diffDays(today, iso)
  // 今天到本週最後一天(週日)還有幾天;一週的起始日見 WEEK_START
  const daysToWeekEnd = (WEEK_START + 6 - weekday(today) + 7) % 7
  let relative: string | null = null
  if (days === 0) {
    relative = '今天'
  } else if (days === 1) {
    // 今天是週日時明天就是下週一;專稱優先
    relative = '明天'
  } else if (days > 1 && days <= daysToWeekEnd) {
    relative = `週${WEEKDAY_LABELS[weekday(iso)]}`
  } else if (days > daysToWeekEnd && days <= daysToWeekEnd + 7) {
    relative = `下週${WEEKDAY_LABELS[weekday(iso)]}`
  }

  return relative === null ? date : `${date} ${relative}`
}

// 重複選單的預覽:月/日 + 星期,跨年才補年份
export function formatShortDate(iso: string, today: string = todayIso()): string {
  const { year, month, day } = parseIso(iso)
  const prefix = year === parseIso(today).year ? '' : `${year}/`
  return `${prefix}${month}/${day} 週${WEEKDAY_LABELS[weekday(iso)]}`
}

// 分類欄底部的今天
export function formatLongDate(iso: string): string {
  const { year, month, day } = parseIso(iso)
  return `${year} 年 ${month} 月 ${day} 日 週${WEEKDAY_LABELS[weekday(iso)]}`
}
