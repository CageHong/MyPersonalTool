'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { localDate } from '@/platform/date'
import { formatLocalDate, monthRange } from '../lib/date'
import { formatMoney } from '../lib/money'
import type { Overview } from '../lib/reports'
import { transactionsHref } from '../lib/transactions'
import MonthlyChart from './MonthlyChart'
import { useReportData } from './ReportPeriod'
import styles from './OverviewPage.module.css'

// 總覽(finance 的預設頁):淨資產、本月對上月、近 12 個月、本月固定支出、旅行、待處理。
// 每一區都連到對應的頁面或篩好的交易清單;數字由 GET /api/finance/reports/overview 一次取回

const URL = '/api/finance/reports/overview'

export default function OverviewPage() {
  const router = useRouter()
  const [today] = useState(() => localDate(new Date()))
  const { data, error, retry } = useReportData<Overview>(`${URL}?today=${today}`)

  if (error) {
    return (
      <div className={styles.page}>
        <h1 className={styles.heading}>總覽</h1>
        <p className={styles.error}>
          {error}{' '}
          <button type="button" className={styles.button} onClick={retry}>
            重試
          </button>
        </p>
      </div>
    )
  }
  if (!data) {
    return (
      <div className={styles.page}>
        <h1 className={styles.heading}>總覽</h1>
        <p className={styles.muted}>載入中…</p>
      </div>
    )
  }

  const money = (amount: number, currency = data.currency) => formatMoney(amount, currency, data.exponents)
  const now = data.thisMonth.summary
  const before = data.lastMonth.summary
  // 跟上月比:正 = 比上月多
  const diff = (current: number, previous: number) => {
    const delta = current - previous
    if (delta === 0) return '跟上月一樣'
    return `比上月${delta > 0 ? '多' : '少'} ${money(Math.abs(delta))}`
  }
  const month = data.today.slice(0, 7)
  const thisRange = { from: data.thisMonth.from, to: data.thisMonth.to }

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>總覽</h1>

      <dl className={styles.stats}>
        <div className={styles.stat}>
          <dt>淨資產</dt>
          <dd className={styles.big}>{money(data.netWorth.netWorth)}</dd>
          <dd className={styles.muted}>可動用 {money(data.netWorth.available)}</dd>
        </div>
        <div className={styles.stat}>
          <dt>
            <Link href={transactionsHref(thisRange)} className={styles.link}>
              {month} 支出
            </Link>
          </dt>
          <dd className={styles.big}>{money(now.expense.total)}</dd>
          <dd className={styles.muted}>
            固定 {money(now.expense.fixed)} · 變動 {money(now.expense.variable)}
          </dd>
          <dd className={styles.muted}>
            {diff(now.expense.total, before.expense.total)}(上月整月 {money(before.expense.total)})
          </dd>
        </div>
        <div className={styles.stat}>
          <dt>{month} 收入</dt>
          <dd className={styles.big}>{money(now.income)}</dd>
          <dd className={styles.muted}>{diff(now.income, before.income)}</dd>
        </div>
        <div className={styles.stat}>
          <dt>{month} 淨額</dt>
          <dd className={styles.big}>{money(now.net)}</dd>
          <dd className={styles.muted}>上月 {money(before.net)}</dd>
        </div>
      </dl>

      <section className={styles.card} aria-labelledby="recent-heading">
        <h2 id="recent-heading" className={styles.subheading}>
          <Link href="/finance/reports" className={styles.link}>
            近 12 個月支出
          </Link>
        </h2>
        <MonthlyChart report={data.recent} onSelect={(m) => router.push(transactionsHref(monthRange(m)))} />
      </section>

      <div className={styles.grid}>
        <section className={styles.card} aria-labelledby="scheduled-heading">
          <h2 id="scheduled-heading" className={styles.subheading}>
            <Link href="/finance/scheduled" className={styles.link}>
              本月固定支出
            </Link>
          </h2>
          {data.scheduled.length === 0 ? (
            <p className={styles.muted}>沒有每月的週期項目。</p>
          ) : (
            <ul className={styles.list}>
              {data.scheduled.map((item) => (
                <li key={item.id} className={styles.row}>
                  <Link href={transactionsHref({ scheduledId: item.id, ...thisRange })} className={styles.link}>
                    {item.name}
                  </Link>
                  {item.count > 0 ? (
                    <span className={styles.done}>
                      已扣 {money(item.total)}
                      {item.count > 1 ? `(${item.count} 次)` : ''}
                      {item.lastAt ? ` · ${formatLocalDate(item.lastAt)}` : ''}
                    </span>
                  ) : (
                    <span className={styles.pending}>
                      未扣 · 預期 {money(item.amountMax, item.currency)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={styles.card} aria-labelledby="trip-heading">
          <h2 id="trip-heading" className={styles.subheading}>
            <Link href="/finance/trips" className={styles.link}>
              {data.trip?.ongoing ? '旅行中' : '最近的旅行'}
            </Link>
          </h2>
          {data.trip ? (
            <>
              <p>
                <Link href={transactionsHref({ tagId: data.trip.tagId })} className={styles.link}>
                  {data.trip.name}
                </Link>
              </p>
              <p className={styles.muted}>
                {data.trip.startsOn ?? '—'} – {data.trip.endsOn ?? '—'},{data.trip.transactionCount} 筆
              </p>
              <p className={styles.big}>{money(data.trip.expense)}</p>
              {data.trip.expenseCategories.slice(0, 3).map((c) => (
                <p key={c.id} className={styles.row}>
                  <span>{c.name}</span>
                  <span className={styles.amount}>{money(c.amount)}</span>
                </p>
              ))}
            </>
          ) : (
            <p className={styles.muted}>還沒有旅行。</p>
          )}
        </section>

        <section className={styles.card} aria-labelledby="todo-heading">
          <h2 id="todo-heading" className={styles.subheading}>
            待處理
          </h2>
          <p className={styles.row}>
            {data.uncategorized > 0 ? (
              <Link href={transactionsHref({ uncategorized: true })} className={styles.link}>
                {data.uncategorized} 筆未分類
              </Link>
            ) : (
              <span className={styles.muted}>沒有未分類的交易</span>
            )}
          </p>
          <p className={styles.row}>
            <span>資料到 {data.lastTransactionDate ?? '—'}</span>
            <Link href="/finance/import" className={styles.link}>
              匯入
            </Link>
          </p>
          {data.netWorth.missingRate > 0 && (
            <p className={styles.error}>{data.netWorth.missingRate} 個帳戶缺匯率,淨資產沒有算進去</p>
          )}
        </section>
      </div>
    </div>
  )
}
