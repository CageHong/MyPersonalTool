// 固定支出報表(唯讀):期間內每個週期項目配對到幾筆、合計、每月平均、最近一筆。
// 加總在 totals.ts(跟每月報表同一套,合計 = 每月報表的固定支出)。語意見 docs/finance/reports.md
import type { FinanceDb } from '../../db/index'
import type { ScheduledReport, ScheduledReportItem } from '../../lib/reports'
import type { TransactionFilter } from '../../lib/transactions'
import { getCurrencyExponents } from '../ledger/lookups'
import { listScheduledDetails } from '../recurring/index'
import { monthsBetween, resolvePeriod } from './period'
import { collectTotals } from './totals'

export function scheduledReport(db: FinanceDb, filter: TransactionFilter): ScheduledReport {
  const totals = collectTotals(db, filter)
  const { from, to } = resolvePeriod(db, filter)
  const months = Math.max(monthsBetween(from, to).length, 1)

  const amountBySchedule = new Map<number, number>()
  for (const cell of totals.cells) {
    if (cell.scheduledId !== null) {
      amountBySchedule.set(cell.scheduledId, (amountBySchedule.get(cell.scheduledId) ?? 0) + cell.amount)
    }
  }

  const items: ScheduledReportItem[] = listScheduledDetails(db)
    .map((s) => {
      const total = amountBySchedule.get(s.id) ?? 0
      const seen = totals.bySchedule.get(s.id)
      return {
        id: s.id,
        name: s.name,
        category: { id: s.categoryId, name: s.categoryName, parentName: s.categoryParent },
        payee: s.payeeName,
        amountMin: s.amountMin,
        amountMax: s.amountMax,
        currency: s.currency,
        frequency: s.frequency,
        interval: s.interval,
        isActive: s.isActive,
        count: seen?.count ?? 0,
        total,
        perMonth: Math.round(total / months),
        lastAt: seen?.lastAt ?? null,
      }
    })
    .filter((item) => item.isActive || item.count > 0)
    .sort((a, b) => Number(b.isActive) - Number(a.isActive) || b.total - a.total || a.name.localeCompare(b.name))

  const total = [...amountBySchedule.values()].reduce((sum, n) => sum + n, 0)
  return {
    currency: totals.currency,
    exponents: getCurrencyExponents(db),
    from,
    to,
    months,
    items,
    total,
    perMonth: Math.round(total / months),
    missingRate: totals.missingRate,
  }
}
