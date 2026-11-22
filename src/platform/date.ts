function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

// 執行環境時區的本地日期（YYYY-MM-DD）
export function localDate(now: Date): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
}

// 執行環境時區的本地時刻（HH:MM）
export function localTime(now: Date): string {
  return `${pad2(now.getHours())}:${pad2(now.getMinutes())}`
}
