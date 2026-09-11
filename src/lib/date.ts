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
