// 期間摘要(唯讀):符合一組篩選條件的交易,支出(固定 / 變動)、收入、淨額、各分類。
// 加總在 totals.ts(跟每月報表同一套)。語意見 docs/finance/reports.md
import type { FinanceDb } from '../../db/index'
import type { TransactionSummary } from '../../lib/reports'
import type { TransactionFilter } from '../../lib/transactions'
import { amountsOf, categoriesOf, collectTotals } from './totals'

export function summarizeTransactions(db: FinanceDb, filter: TransactionFilter): TransactionSummary {
  const totals = collectTotals(db, filter)
  let transactionCount = 0
  for (const n of totals.transactionsByMonth.values()) transactionCount += n
  return {
    currency: totals.currency,
    ...amountsOf(totals.cells),
    expenseCategories: categoriesOf(totals.cells, totals.accounts, 'expense'),
    incomeCategories: categoriesOf(totals.cells, totals.accounts, 'income'),
    transactionCount,
    missingRate: totals.missingRate,
  }
}
