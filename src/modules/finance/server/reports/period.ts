// 報表的期間:沒給開始或結束時,用帳本第一筆或最後一筆交易的日期(UTC 切日);月份清單
import { sql } from 'drizzle-orm'
import type { FinanceDb } from '../../db/index'
import type { TransactionFilter } from '../../lib/transactions'

export function resolvePeriod(db: FinanceDb, filter: TransactionFilter): { from: string | null; to: string | null } {
  const bounds = db.all<{ first: string | null; last: string | null }>(
    sql`SELECT substr(MIN(occurred_at), 1, 10) AS first, substr(MAX(occurred_at), 1, 10) AS last FROM finance_transactions`,
  )[0]
  return { from: filter.from ?? bounds?.first ?? null, to: filter.to ?? bounds?.last ?? null }
}

// from 的月份到 to 的月份(含),YYYY-MM;任一端沒有或順序相反時是空的
export function monthsBetween(from: string | null, to: string | null): string[] {
  if (!from || !to || from > to) return []
  const months: string[] = []
  let [year, month] = from.split('-').map(Number) as [number, number]
  const [endYear, endMonth] = to.split('-').map(Number) as [number, number]
  while (year < endYear || (year === endYear && month <= endMonth)) {
    months.push(`${year}-${String(month).padStart(2, '0')}`)
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  }
  return months
}
