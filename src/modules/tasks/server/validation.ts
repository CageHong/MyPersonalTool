// src/modules/tasks/server/ 各模組共用的驗證常數

// 日曆日,YYYY-MM-DD
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

// 先比對形狀,再用 UTC 往返確認年月日沒被進位:
// 2026-13-01、2026-02-30 形狀合法,但 Date 會把它們正規化成別的日子
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    return false
  }
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  )
}

// 無 / 低 / 中 / 高;刻意留空隙,之後插一級不動既有資料
export const PRIORITY_VALUES: readonly number[] = [0, 1, 3, 5]
