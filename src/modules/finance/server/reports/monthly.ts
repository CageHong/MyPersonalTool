// 每月報表(唯讀):期間內每個月的支出(固定 / 變動)、收入、淨額,合計與每月平均,各分類。
// 加總在 totals.ts(跟期間摘要同一套)。語意見 docs/finance/reports.md
import { sql } from 'drizzle-orm'
import type { FinanceDb } from '../../db/index'
import type { MonthlyReport, ReportAmounts } from '../../lib/reports'
import type { TransactionFilter } from '../../lib/transactions'
import { getCurrencyExponents } from '../ledger/lookups'
import { amountsOf, categoriesOf, collectTotals } from './totals'

// from 的月份到 to 的月份(含),YYYY-MM
function monthsBetween(from: string, to: string): string[] {
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

export function monthlyReport(db: FinanceDb, filter: TransactionFilter): MonthlyReport {
  const totals = collectTotals(db, filter)
  // 沒給開始或結束:用帳本第一筆或最後一筆交易的日期(UTC 切日)
  const bounds = db.all<{ first: string | null; last: string | null }>(
    sql`SELECT substr(MIN(occurred_at), 1, 10) AS first, substr(MAX(occurred_at), 1, 10) AS last FROM finance_transactions`,
  )[0]
  const from = filter.from ?? bounds?.first ?? null
  const to = filter.to ?? bounds?.last ?? null
  const monthList = from && to && from <= to ? monthsBetween(from, to) : []

  const months = monthList.map((month) => ({
    month,
    ...amountsOf(totals.cells.filter((cell) => cell.month === month)),
    transactionCount: totals.transactionsByMonth.get(month) ?? 0,
  }))
  const total = amountsOf(totals.cells)
  const count = Math.max(monthList.length, 1)
  const avg = (n: number) => Math.round(n / count)
  const average: ReportAmounts = {
    expense: { total: avg(total.expense.total), fixed: avg(total.expense.fixed), variable: avg(total.expense.variable) },
    income: avg(total.income),
    net: avg(total.net),
  }
  return {
    currency: totals.currency,
    exponents: getCurrencyExponents(db),
    from,
    to,
    months,
    total,
    average,
    expenseCategories: categoriesOf(totals.cells, totals.accounts, 'expense'),
    incomeCategories: categoriesOf(totals.cells, totals.accounts, 'income'),
    missingRate: totals.missingRate,
  }
}
