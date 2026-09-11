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
  const firstWeekday = new Date(year, month - 1, 1).getDay()
  // 下個月的第 0 天 = 這個月的最後一天
  const dayCount = new Date(year, month, 0).getDate()

  const cells: (string | null)[] = Array.from({ length: firstWeekday }, () => null)
  for (let day = 1; day <= dayCount; day += 1) {
    cells.push(formatIso({ year, month, day }))
  }
  return cells
}

export const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']

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

// 今天 / 明天 / 昨天 / 本週內的星期 / 月日(跨年才補年份)
export function formatRelativeDate(iso: string, today: string = todayIso()): string {
  const days = diffDays(today, iso)

  if (days === 0) {
    return '今天'
  }
  if (days === 1) {
    return '明天'
  }
  if (days === -1) {
    return '昨天'
  }
  // 「本週內」= 今天之後 6 天內,對得上「未來 7 天」那個檢視,不是日曆週
  if (days >= 2 && days <= 6) {
    return `週${WEEKDAY_LABELS[weekday(iso)]}`
  }

  const date = parseIso(iso)
  const sameYear = date.year === parseIso(today).year
  return sameYear
    ? `${date.month}/${date.day}`
    : `${date.year}/${date.month}/${date.day}`
}

// 分類欄底部的今天
export function formatLongDate(iso: string): string {
  const { year, month, day } = parseIso(iso)
  return `${year} 年 ${month} 月 ${day} 日 週${WEEKDAY_LABELS[weekday(iso)]}`
}
