// 旅行報表(唯讀):每個有日期範圍的標籤(旅行)一趟:日期、筆數、支出、收入、各分類。
// 交易 = 掛了那個標籤的交易(日期範圍只是加標籤的線索,不拿來篩選);加總在 totals.ts。語意見 docs/finance/reports.md
import type { FinanceDb } from '../../db/index'
import type { TripReport, TripReportItem } from '../../lib/reports'
import { getCurrencyExponents, getDisplayCurrency } from '../ledger/lookups'
import { listTags } from '../tags/index'
import { amountsOf, categoriesOf, collectTotals } from './totals'

export function tripReport(db: FinanceDb): TripReport {
  let missingRate = 0
  const trips: TripReportItem[] = listTags(db)
    .filter((tag) => tag.startsOn !== null || tag.endsOn !== null)
    .map((tag) => {
      const totals = collectTotals(db, { order: 'desc', tagId: tag.id })
      missingRate += totals.missingRate
      const amounts = amountsOf(totals.cells)
      let transactionCount = 0
      for (const n of totals.transactionsByMonth.values()) transactionCount += n
      return {
        tagId: tag.id,
        name: tag.name,
        startsOn: tag.startsOn,
        endsOn: tag.endsOn,
        transactionCount,
        expense: amounts.expense.total,
        income: amounts.income,
        expenseCategories: categoriesOf(totals.cells, totals.accounts, 'expense'),
      }
    })
    .sort((a, b) => (b.startsOn ?? b.endsOn ?? '').localeCompare(a.startsOn ?? a.endsOn ?? ''))
  return { currency: getDisplayCurrency(db), exponents: getCurrencyExponents(db), trips, missingRate }
}
