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

// ── 報表的期間 ───────────────────────────────────────────────
// 「過去 12 個月」是含本月在內的 12 個完整月份;all = 不限(從第一筆到最後一筆交易)

export const REPORT_PRESETS = [
  { key: 'last12', label: '過去 12 個月' },
  { key: 'thisYear', label: '今年' },
  { key: 'lastYear', label: '去年' },
  { key: 'all', label: '全部' },
] as const
export type ReportPreset = (typeof REPORT_PRESETS)[number]['key']

export function reportRange(preset: ReportPreset, today: string): { from?: string; to?: string } {
  const { year, monthIndex } = partsOf(today)
  switch (preset) {
    case 'last12':
      return { from: isoOf(year, monthIndex - 11, 1), to: isoOf(year, monthIndex + 1, 0) }
    case 'thisYear':
      return { from: isoOf(year, 0, 1), to: isoOf(year, 11, 31) }
    case 'lastYear':
      return { from: isoOf(year - 1, 0, 1), to: isoOf(year - 1, 11, 31) }
    case 'all':
      return {}
  }
}

// YYYY-MM → 那個月的第一天與最後一天
export function monthRange(month: string): { from: string; to: string } {
  const { year, monthIndex } = partsOf(`${month}-01`)
  return { from: isoOf(year, monthIndex, 1), to: isoOf(year, monthIndex + 1, 0) }
}

// ── 期間的前後切換(◀ ▶)──────────────────────────────────────
// 目前的期間剛好是一個完整的月(1 號到月底)或完整的年(1/1 到 12/31)才能切換,一次移一期;
// 自訂長度與全部期間不能切換(回傳 null,按鈕停用)。不管是哪個快捷選出來的都一樣

export type RangeStep = 'month' | 'year'

export function rangeStep(from: string | undefined, to: string | undefined): RangeStep | null {
  if (!from || !to) return null
  const start = partsOf(from)
  if (start.day !== 1) return null
  if (start.monthIndex === 0 && to === isoOf(start.year, 11, 31)) return 'year'
  if (to === isoOf(start.year, start.monthIndex + 1, 0)) return 'month'
  return null
}

export function shiftRange(
  from: string | undefined,
  to: string | undefined,
  direction: -1 | 1,
): { from: string; to: string } | null {
  const step = rangeStep(from, to)
  if (!step || !from) return null
  const { year, monthIndex } = partsOf(from)
  if (step === 'year') return { from: isoOf(year + direction, 0, 1), to: isoOf(year + direction, 11, 31) }
  return { from: isoOf(year, monthIndex + direction, 1), to: isoOf(year, monthIndex + direction + 1, 0) }
}

// 完整的月或年的名稱(期間選單在對不上快捷時顯示它,不顯示「自訂」);其他期間回傳 null
export function rangeLabel(from: string | undefined, to: string | undefined): string | null {
  const step = rangeStep(from, to)
  if (!step || !from) return null
  const { year, monthIndex } = partsOf(from)
  return step === 'year' ? `${year} 年` : `${year} 年 ${monthIndex + 1} 月`
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
