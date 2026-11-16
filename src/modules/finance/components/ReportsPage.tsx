'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { getJson, loadErrorMessage } from '../lib/api'
import { REPORT_PRESETS, localToday, monthRange, reportRange } from '../lib/date'
import type { ReportPreset } from '../lib/date'
import { formatMoney } from '../lib/money'
import type { MonthlyReport, ReportAmounts, SummaryCategory } from '../lib/reports'
import { filterToSearchParams } from '../lib/transactions'
import type { TransactionFilter } from '../lib/transactions'
import MonthlyChart from './MonthlyChart'
import styles from './ReportsPage.module.css'

// 報表:選期間 → 每月支出長條圖(固定 / 變動)、各分類支出、每月數字(合計、每月平均)。
// 月份、分類都可以點,跳到篩好的交易清單。期間的預設存在瀏覽器的 localStorage

const URL = '/api/finance/reports/monthly'
const DEFAULT_KEY = 'finance.reports.defaultPeriod'

type Period = { preset: ReportPreset } | { preset: 'custom'; from?: string; to?: string }
const FALLBACK: Period = { preset: 'last12' }

function readDefault(): Period {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(DEFAULT_KEY) ?? 'null')
    if (value && typeof value === 'object') {
      const preset = (value as { preset?: unknown }).preset
      if (REPORT_PRESETS.some((p) => p.key === preset)) return { preset: preset as ReportPreset }
      if (preset === 'custom') {
        const { from, to } = value as { from?: unknown; to?: unknown }
        const date = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined)
        return { preset: 'custom', from: date(from), to: date(to) }
      }
    }
  } catch {
    // 讀不到或格式不對:用內建的預設
  }
  return FALLBACK
}

// 交易清單的網址(報表上的月份、分類點下去)
function transactionsHref(filter: Omit<TransactionFilter, 'order'>): string {
  return `/finance/transactions?${filterToSearchParams({ order: 'desc', ...filter })}`
}

export default function ReportsPage() {
  const router = useRouter()
  const [today] = useState(() => localToday())
  const [period, setPeriod] = useState<Period>(FALLBACK)
  const [saved, setSaved] = useState(false)
  const [loaded, setLoaded] = useState<{ query: string; report: MonthlyReport } | null>(null)
  const [error, setError] = useState<{ query: string; message: string } | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    // 掛載後套用瀏覽器記住的預設期間(伺服器端沒有 localStorage,render 時讀會 hydration 不一致)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPeriod(readDefault())
  }, [])

  const range = period.preset === 'custom' ? { from: period.from, to: period.to } : reportRange(period.preset, today)
  const query = filterToSearchParams({ order: 'desc', ...range }).toString()

  useEffect(() => {
    const controller = new AbortController()
    getJson<MonthlyReport>(`${URL}?${query}`, controller.signal)
      .then((report) => {
        setLoaded({ query, report })
        setError(null)
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setError({ query, message: loadErrorMessage(caught) })
      })
    return () => controller.abort()
  }, [query, attempt])

  function choose(next: Period) {
    setPeriod(next)
    setSaved(false)
  }
  function saveDefault() {
    try {
      window.localStorage.setItem(DEFAULT_KEY, JSON.stringify(period))
      setSaved(true)
    } catch {
      // 存不了:不顯示「已設為預設」
    }
  }

  const report = loaded?.report ?? null
  const money = (amount: number) => (report ? formatMoney(amount, report.currency, report.exponents) : '')

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.heading}>報表</h1>
        <div className={styles.period}>
          <select
            className={styles.field}
            aria-label="期間"
            value={period.preset}
            onChange={(event) => {
              const value = event.target.value
              if (value === 'custom') choose({ preset: 'custom', ...range })
              else choose({ preset: value as ReportPreset })
            }}
          >
            {REPORT_PRESETS.map(({ key, label }) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
            <option value="custom">自訂</option>
          </select>
          {period.preset === 'custom' && (
            <>
              <input
                className={styles.field}
                type="date"
                aria-label="開始日期"
                value={period.from ?? ''}
                max={period.to}
                onChange={(event) => choose({ ...period, from: event.target.value || undefined })}
              />
              <span className={styles.muted}>–</span>
              <input
                className={styles.field}
                type="date"
                aria-label="結束日期"
                value={period.to ?? ''}
                min={period.from}
                onChange={(event) => choose({ ...period, to: event.target.value || undefined })}
              />
            </>
          )}
          <button type="button" className={styles.button} onClick={saveDefault}>
            設為預設
          </button>
          {saved && <span className={styles.muted}>已設為預設</span>}
        </div>
      </header>

      {error?.query === query && (
        <p className={styles.error}>
          {error.message}{' '}
          <button type="button" className={styles.button} onClick={() => setAttempt((n) => n + 1)}>
            重試
          </button>
        </p>
      )}
      {!report && !error && <p className={styles.muted}>載入中…</p>}

      {report && (
        <div className={loaded?.query === query ? styles.content : `${styles.content} ${styles.stale}`} aria-busy={loaded?.query !== query}>
          <p className={styles.muted}>
            {report.from ?? '—'} – {report.to ?? '—'},{report.months.length} 個月
            {report.missingRate > 0 && <span className={styles.error}>;{report.missingRate} 筆缺匯率,沒有算進去</span>}
          </p>

          <dl className={styles.totals}>
            <div>
              <dt>支出合計</dt>
              <dd className={styles.big}>{money(report.total.expense.total)}</dd>
              <dd className={styles.muted}>
                固定 {money(report.total.expense.fixed)} · 變動 {money(report.total.expense.variable)}
              </dd>
            </div>
            <div>
              <dt>每月平均支出</dt>
              <dd className={styles.big}>{money(report.average.expense.total)}</dd>
            </div>
            <div>
              <dt>收入合計</dt>
              <dd className={styles.big}>{money(report.total.income)}</dd>
            </div>
            <div>
              <dt>淨額</dt>
              <dd className={styles.big}>{money(report.total.net)}</dd>
            </div>
          </dl>

          <section className={styles.block} aria-labelledby="chart-heading">
            <h2 id="chart-heading" className={styles.subheading}>
              每月支出
            </h2>
            <MonthlyChart report={report} onSelect={(month) => router.push(transactionsHref(monthRange(month)))} />
          </section>

          <div className={styles.columns}>
            <CategoryBlock
              title="各分類支出"
              categories={report.expenseCategories}
              total={report.total.expense.total}
              months={report.months.length}
              money={money}
              href={(categoryId) => transactionsHref({ categoryId, from: report.from ?? undefined, to: report.to ?? undefined })}
            />
            <CategoryBlock
              title="各分類收入"
              categories={report.incomeCategories}
              total={report.total.income}
              months={report.months.length}
              money={money}
              href={(categoryId) => transactionsHref({ categoryId, from: report.from ?? undefined, to: report.to ?? undefined })}
            />
          </div>

          <section className={styles.block} aria-labelledby="months-heading">
            <h2 id="months-heading" className={styles.subheading}>
              每月數字
            </h2>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>月份</th>
                    <th className={styles.right}>固定</th>
                    <th className={styles.right}>變動</th>
                    <th className={styles.right}>支出合計</th>
                    <th className={styles.right}>收入</th>
                    <th className={styles.right}>淨額</th>
                  </tr>
                </thead>
                <tbody>
                  {[...report.months].reverse().map((m) => (
                    <tr key={m.month}>
                      <td>
                        <Link href={transactionsHref(monthRange(m.month))} className={styles.link}>
                          {m.month}
                        </Link>
                      </td>
                      <AmountCells amounts={m} money={money} />
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">合計</th>
                    <AmountCells amounts={report.total} money={money} />
                  </tr>
                  <tr>
                    <th scope="row">每月平均</th>
                    <AmountCells amounts={report.average} money={money} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

function AmountCells({ amounts, money }: { amounts: ReportAmounts; money: (amount: number) => string }) {
  return (
    <>
      <td className={styles.amount}>{money(amounts.expense.fixed)}</td>
      <td className={styles.amount}>{money(amounts.expense.variable)}</td>
      <td className={styles.amount}>{money(amounts.expense.total)}</td>
      <td className={styles.amount}>{money(amounts.income)}</td>
      <td className={styles.amount}>{money(amounts.net)}</td>
    </>
  )
}

type CategoryProps = {
  title: string
  categories: SummaryCategory[]
  total: number
  months: number
  money: (amount: number) => string
  href: (categoryId: number) => string
}

// 一個分類表:上層(含子分類)、佔合計的比例、每月平均;子分類縮排在下面。點分類 → 交易清單
function CategoryBlock({ title, categories, total, months, money, href }: CategoryProps) {
  if (!categories.length) return null
  const share = (amount: number) => (total > 0 ? `${Math.round((amount / total) * 100)}%` : '')
  const perMonth = (amount: number) => money(Math.round(amount / Math.max(months, 1)))
  const row = (id: number, name: string, amount: number, child: boolean) => (
    <tr key={id} className={child ? styles.child : undefined}>
      <th scope="row">
        <Link href={href(id)} className={styles.link}>
          {name}
        </Link>
      </th>
      <td className={styles.amount}>{money(amount)}</td>
      <td className={styles.share}>{child ? '' : share(amount)}</td>
      <td className={styles.amount}>{perMonth(amount)}</td>
    </tr>
  )
  return (
    <section className={styles.block}>
      <h2 className={styles.subheading}>{title}</h2>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>分類</th>
            <th className={styles.right}>合計</th>
            <th className={styles.right}>比例</th>
            <th className={styles.right}>每月平均</th>
          </tr>
        </thead>
        <tbody>
          {categories.flatMap((c) => [row(c.id, c.name, c.amount, false), ...c.children.map((x) => row(x.id, x.name, x.amount, true))])}
        </tbody>
      </table>
    </section>
  )
}
