// 總覽頁(唯讀):淨資產、本月對上月、近 12 個月、本月固定支出、旅行、待處理(未分類、資料最後日期)。
// 只組合其他報表函式的結果,不另寫加總。語意見 docs/finance/reports.md
import type { FinanceDb } from '../../db/index'
import { monthRange, reportRange } from '../../lib/date'
import type { Overview } from '../../lib/reports'
import { getCurrencyExponents, getDisplayCurrency } from '../ledger/lookups'
import { MAX_PAGE_SIZE, listTransactions } from '../ledger/list'
import { monthlyReport } from './monthly'
import { getNetWorth } from './net-worth'
import { resolvePeriod } from './period'
import { scheduledReport } from './scheduled'
import { summarizeTransactions } from './summary'
import { tripReport } from './trips'

function previousMonth(month: string): string {
  const [year, m] = month.split('-').map(Number) as [number, number]
  return m === 1 ? `${year - 1}-12` : `${year}-${String(m - 1).padStart(2, '0')}`
}

function countUncategorized(db: FinanceDb): number {
  let count = 0
  let cursor: string | undefined
  do {
    const page = listTransactions(db, { order: 'desc', uncategorized: true }, { cursor, limit: MAX_PAGE_SIZE })
    count += page.items.length
    cursor = page.nextCursor ?? undefined
  } while (cursor)
  return count
}

// today:YYYY-MM-DD(瀏覽器的今天);月份照帳本的慣例以 UTC 切
export function getOverview(db: FinanceDb, today: string): Overview {
  const thisRange = monthRange(today.slice(0, 7))
  const lastRange = monthRange(previousMonth(today.slice(0, 7)))
  const thisFilter = { order: 'desc' as const, ...thisRange }

  const scheduled = scheduledReport(db, thisFilter).items.filter(
    (item) => (item.isActive && item.frequency === 'monthly' && item.interval === 1) || item.count > 0,
  )

  const trips = tripReport(db).trips
  const ongoing = trips.find(
    (t) => (t.startsOn === null || t.startsOn <= today) && (t.endsOn === null || t.endsOn >= today),
  )
  const latest = trips.find((t) => t.startsOn !== null && t.startsOn <= today) ?? trips[0]
  const trip = ongoing ? { ...ongoing, ongoing: true } : latest ? { ...latest, ongoing: false } : null

  return {
    currency: getDisplayCurrency(db),
    exponents: getCurrencyExponents(db),
    today,
    thisMonth: { ...thisRange, summary: summarizeTransactions(db, thisFilter) },
    lastMonth: { ...lastRange, summary: summarizeTransactions(db, { order: 'desc', ...lastRange }) },
    netWorth: getNetWorth(db, today),
    recent: monthlyReport(db, { order: 'desc', ...reportRange('last12', today) }),
    scheduled,
    trip,
    uncategorized: countUncategorized(db),
    lastTransactionDate: resolvePeriod(db, { order: 'desc' }).to,
  }
}
