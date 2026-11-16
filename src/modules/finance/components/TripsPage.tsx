'use client'

import Link from 'next/link'
import { formatMoney } from '../lib/money'
import type { TripReport } from '../lib/reports'
import { transactionsHref } from '../lib/transactions'
import { useReportData } from './ReportPeriod'
import styles from './ReportsPage.module.css'

// 旅行:每個有日期範圍的標籤一趟,日期、筆數、支出、各分類。點旅行或分類 → 掛了那個標籤的交易

const URL = '/api/finance/reports/trips'

export default function TripsPage() {
  const { data: report, error, retry } = useReportData<TripReport>(URL)
  const money = (amount: number) => (report ? formatMoney(amount, report.currency, report.exponents) : '')

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.heading}>旅行</h1>
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
      {report?.missingRate ? <p className={styles.error}>{report.missingRate} 筆缺匯率,沒有算進去</p> : null}
      {report && report.trips.length === 0 && (
        <p className={styles.muted}>還沒有旅行。在「管理 → 標籤」替標籤設定日期範圍,它就會出現在這裡。</p>
      )}

      {report && report.trips.length > 0 && (
        <div className={styles.columns}>
          {report.trips.map((trip) => (
            <section key={trip.tagId} className={styles.block} aria-labelledby={`trip-${trip.tagId}`}>
              <h2 id={`trip-${trip.tagId}`} className={styles.subheading}>
                <Link href={transactionsHref({ tagId: trip.tagId })} className={styles.link}>
                  {trip.name}
                </Link>
              </h2>
              <p className={styles.muted}>
                {trip.startsOn ?? '—'} – {trip.endsOn ?? '—'},{trip.transactionCount} 筆
              </p>
              <dl className={styles.totals}>
                <div>
                  <dt>支出</dt>
                  <dd className={styles.big}>{money(trip.expense)}</dd>
                </div>
                {trip.income !== 0 && (
                  <div>
                    <dt>收入 / 退款</dt>
                    <dd className={styles.big}>{money(trip.income)}</dd>
                  </div>
                )}
              </dl>
              {trip.expenseCategories.length > 0 && (
                <table className={styles.table}>
                  <tbody>
                    {trip.expenseCategories.flatMap((c) => [
                      <tr key={c.id}>
                        <th scope="row">
                          <Link href={transactionsHref({ tagId: trip.tagId, categoryId: c.id })} className={styles.link}>
                            {c.name}
                          </Link>
                        </th>
                        <td className={styles.amount}>{money(c.amount)}</td>
                        <td className={styles.share}>
                          {trip.expense > 0 ? `${Math.round((c.amount / trip.expense) * 100)}%` : ''}
                        </td>
                      </tr>,
                      ...c.children.map((x) => (
                        <tr key={x.id} className={styles.child}>
                          <th scope="row">
                            <Link href={transactionsHref({ tagId: trip.tagId, categoryId: x.id })} className={styles.link}>
                              {x.name}
                            </Link>
                          </th>
                          <td className={styles.amount}>{money(x.amount)}</td>
                          <td className={styles.share} />
                        </tr>
                      )),
                    ])}
                  </tbody>
                </table>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
