'use client'

import Link from 'next/link'
import { formatLocalDate } from '../lib/date'
import { formatMoney } from '../lib/money'
import type { ScheduledReport, ScheduledReportItem } from '../lib/reports'
import { transactionsHref } from '../lib/transactions'
import { ReportPeriodPicker, useReportData, useReportPeriod } from './ReportPeriod'
import styles from './ReportsPage.module.css'

// 固定支出:期間內每個週期項目配對到幾筆、合計、每月平均、最近一筆。點項目 → 配對到它的交易(同一段期間)

const URL = '/api/finance/reports/scheduled'

const FREQUENCY: Record<ScheduledReportItem['frequency'], [string, string]> = {
  weekly: ['每週', '週'],
  monthly: ['每月', '個月'],
  yearly: ['每年', '年'],
}

function frequencyLabel(item: ScheduledReportItem): string {
  const [single, unit] = FREQUENCY[item.frequency]
  return item.interval === 1 ? single : `每 ${item.interval} ${unit}`
}

export default function ScheduledPage() {
  const periodState = useReportPeriod()
  const { data: report, stale, error, retry } = useReportData<ScheduledReport>(`${URL}?${periodState.query}`)
  const money = (amount: number, currency?: string) =>
    report ? formatMoney(amount, currency ?? report.currency, report.exponents) : ''

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.heading}>固定支出</h1>
        <ReportPeriodPicker state={periodState} />
      </header>

      {error && (
        <p className={styles.error}>
          {error}{' '}
          <button type="button" className={styles.button} onClick={retry}>
            重試
          </button>
        </p>
      )}
      {!report && !error && <p className={styles.muted}>載入中…</p>}

      {report && (
        <div className={stale ? `${styles.content} ${styles.stale}` : styles.content} aria-busy={stale}>
          <p className={styles.muted}>
            {report.from ?? '—'} – {report.to ?? '—'},{report.months} 個月
            {report.missingRate > 0 && <span className={styles.error}>;{report.missingRate} 筆缺匯率,沒有算進去</span>}
          </p>
          <dl className={styles.totals}>
            <div>
              <dt>固定支出合計</dt>
              <dd className={styles.big}>{money(report.total)}</dd>
            </div>
            <div>
              <dt>每月平均</dt>
              <dd className={styles.big}>{money(report.perMonth)}</dd>
            </div>
          </dl>

          {report.items.length === 0 ? (
            <p className={styles.muted}>還沒有週期項目。</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>項目</th>
                    <th>分類</th>
                    <th>收款人</th>
                    <th className={styles.right}>預期金額</th>
                    <th className={styles.right}>筆數</th>
                    <th className={styles.right}>合計</th>
                    <th className={styles.right}>每月平均</th>
                    <th>最近一筆</th>
                  </tr>
                </thead>
                <tbody>
                  {report.items.map((item) => (
                    <tr key={item.id} className={item.isActive ? undefined : styles.child}>
                      <th scope="row">
                        <Link
                          href={transactionsHref({ scheduledId: item.id, from: report.from ?? undefined, to: report.to ?? undefined })}
                          className={styles.link}
                        >
                          {item.name}
                        </Link>
                        {item.isActive ? '' : '(已停用)'}
                      </th>
                      <td>{item.category.parentName ? `${item.category.parentName} / ${item.category.name}` : item.category.name}</td>
                      <td>{item.payee}</td>
                      <td className={styles.amount}>
                        {item.amountMin === item.amountMax
                          ? money(item.amountMin, item.currency)
                          : `${money(item.amountMin, item.currency)} – ${money(item.amountMax, item.currency)}`}
                        <span className={styles.muted}> · {frequencyLabel(item)}</span>
                      </td>
                      <td className={styles.amount}>{item.count}</td>
                      <td className={styles.amount}>{money(item.total)}</td>
                      <td className={styles.amount}>{money(item.perMonth)}</td>
                      <td className={styles.muted}>{item.lastAt ? formatLocalDate(item.lastAt) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
