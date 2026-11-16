// 每月報表(唯讀):期間內每個月的支出(固定 / 變動)、收入、淨額,合計與每月平均,各分類。
// 加總在 totals.ts(跟期間摘要同一套)。語意見 docs/finance/reports.md
import type { FinanceDb } from '../../db/index'
import type { MonthlyReport, ReportAmounts } from '../../lib/reports'
import type { TransactionFilter } from '../../lib/transactions'
import { getCurrencyExponents } from '../ledger/lookups'
import { monthsBetween, resolvePeriod } from './period'
import { amountsOf, categoriesOf, collectTotals } from './totals'

export function monthlyReport(db: FinanceDb, filter: TransactionFilter): MonthlyReport {
  const totals = collectTotals(db, filter)
  const { from, to } = resolvePeriod(db, filter)
  const monthList = monthsBetween(from, to)

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
