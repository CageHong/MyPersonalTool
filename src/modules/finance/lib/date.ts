// 存的是 UTC 的 ISO 8601;顯示時轉成瀏覽器所在時區的日期(YYYY-MM-DD)
export function formatLocalDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

// ── 期間快捷(交易清單的日期篩選)────────────────────────────────
// 日期都是 YYYY-MM-DD 字串;計算時用 UTC 的 Date 當計算器,不受執行環境的時區影響

export const RANGE_PRESETS = [
  { key: 'thisMonth', label: '本月' },
  { key: 'lastMonth', label: '上月' },
  { key: 'thisYear', label: '今年' },
  { key: 'last30', label: '過去 30 天' },
] as const
export type RangePreset = (typeof RANGE_PRESETS)[number]['key']

function isoOf(year: number, monthIndex: number, day: number): string {
  return new Date(Date.UTC(year, monthIndex, day)).toISOString().slice(0, 10)
}

function partsOf(iso: string): { year: number; monthIndex: number; day: number } {
  const [year, month, day] = iso.split('-').map(Number) as [number, number, number]
  return { year, monthIndex: month - 1, day }
}

// 瀏覽器所在時區的今天
export function localToday(now: Date = new Date()): string {
  return formatLocalDate(now.toISOString())
}

// 快捷 → 日期範圍(含頭尾)。月與年給完整的期間,不截到今天:同一個月內每天都對得上同一個快捷
export function presetRange(preset: RangePreset, today: string): { from: string; to: string } {
  const { year, monthIndex, day } = partsOf(today)
  switch (preset) {
    case 'thisMonth':
      return { from: isoOf(year, monthIndex, 1), to: isoOf(year, monthIndex + 1, 0) }
    case 'lastMonth':
      return { from: isoOf(year, monthIndex - 1, 1), to: isoOf(year, monthIndex, 0) }
    case 'thisYear':
      return { from: isoOf(year, 0, 1), to: isoOf(year, 11, 31) }
    case 'last30':
      return { from: isoOf(year, monthIndex, day - 29), to: today }
  }
}

// 目前的日期範圍對應哪個快捷;都沒有給是 all,對不上任何快捷是 custom
export function matchPreset(from: string | undefined, to: string | undefined, today: string): RangePreset | 'all' | 'custom' {
  if (!from && !to) return 'all'
  const hit = RANGE_PRESETS.find(({ key }) => {
    const range = presetRange(key, today)
    return range.from === from && range.to === to
  })
  return hit ? hit.key : 'custom'
}

// ── 編輯時的日期時間欄位(<input type="datetime-local" step="1">)───────
// 欄位的值是瀏覽器所在時區的 YYYY-MM-DDTHH:MM:SS;存的是 UTC

// UTC 的 ISO 8601 → 欄位的值
export function toLocalInputValue(iso: string): string {
  const date = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  )
}

// 欄位的值(秒可以省略)→ UTC 的 ISO 8601;不合法(含不存在的日期)時是 null
export function fromLocalInputValue(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value)
  if (!match) return null
  const [year, month, day, hour, minute, second = '0'] = match.slice(1).map((part) => part ?? '0')
  const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second))
  if (Number.isNaN(date.getTime()) || date.getMonth() !== Number(month) - 1 || date.getDate() !== Number(day)) return null
  return date.toISOString()
}
