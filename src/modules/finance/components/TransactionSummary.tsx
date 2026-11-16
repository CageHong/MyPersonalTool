'use client'

import { useEffect, useState } from 'react'
import { getJson, loadErrorMessage } from '../lib/api'
import { formatMoney } from '../lib/money'
import type { SummaryCategory, TransactionSummary as Summary } from '../lib/reports'
import styles from './TransactionSummary.module.css'

// 交易清單上方的期間摘要:依目前的篩選條件算支出(固定 / 變動)、收入、淨額;分類明細可以收合。
// 數字由伺服器算(GET /api/finance/reports/summary,條件跟清單相同)

const SUMMARY_URL = '/api/finance/reports/summary'
const OPEN_KEY = 'finance.summary.categoriesOpen'

type Props = {
  // 篩選條件的查詢字串(跟清單用的同一個)
  query: string
  // 帳本改了(新增、編輯、刪除)就加一,讓摘要重新取
  revision: number
  exponents: Record<string, number>
}

type Loaded = { key: string; summary: Summary }

export default function TransactionSummary({ query, revision, exponents }: Props) {
  const key = `${query}#${revision}`
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState<{ key: string; message: string } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    try {
      // 掛載後同步一次瀏覽器記住的展開狀態(伺服器端沒有 localStorage,render 時讀會 hydration 不一致)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(window.localStorage.getItem(OPEN_KEY) === '1')
    } catch {
      // 讀不到就維持收合
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    getJson<Summary>(`${SUMMARY_URL}?${query}`, controller.signal)
      .then((summary) => {
        setLoaded({ key, summary })
        setError(null)
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setError({ key, message: loadErrorMessage(caught) })
      })
    return () => controller.abort()
  }, [key, query, attempt])

  function toggle() {
    const next = !open
    setOpen(next)
    try {
      window.localStorage.setItem(OPEN_KEY, next ? '1' : '0')
    } catch {
      // 存不了就只在這次瀏覽有效
    }
  }

  if (error?.key === key) {
    return (
      <section className={styles.summary} aria-label="期間摘要">
        <span className={styles.error}>摘要:{error.message}</span>{' '}
        <button type="button" className={styles.button} onClick={() => setAttempt((n) => n + 1)}>
          重試
        </button>
      </section>
    )
  }
  if (!loaded) {
    return (
      <section className={styles.summary} aria-label="期間摘要" aria-busy="true">
        <span className={styles.muted}>摘要計算中…</span>
      </section>
    )
  }

  const { summary } = loaded
  const money = (amount: number) => formatMoney(amount, summary.currency, exponents)
  const hasCategories = summary.expenseCategories.length > 0 || summary.incomeCategories.length > 0
  return (
    // 換條件時新數字到之前先留著舊的(淡化)
    <section
      className={loaded.key === key ? styles.summary : `${styles.summary} ${styles.stale}`}
      aria-label="期間摘要"
      aria-busy={loaded.key !== key}
    >
      <dl className={styles.totals}>
        <div>
          <dt>支出</dt>
          <dd className={styles.amount}>{money(summary.expense.total)}</dd>
          <dd className={styles.breakdown}>
            固定 {money(summary.expense.fixed)} · 變動 {money(summary.expense.variable)}
          </dd>
        </div>
        <div>
          <dt>收入</dt>
          <dd className={styles.amount}>{money(summary.income)}</dd>
        </div>
        <div>
          <dt>淨額</dt>
          <dd className={styles.amount}>{money(summary.net)}</dd>
        </div>
        <div className={styles.side}>
          <span className={styles.muted}>{summary.transactionCount} 筆</span>
          {summary.missingRate > 0 && (
            <span className={styles.warning}>{summary.missingRate} 筆缺匯率,沒有算進去</span>
          )}
          {hasCategories && (
            <button type="button" className={styles.button} aria-expanded={open} onClick={toggle}>
              {open ? '收起分類' : '分類明細'}
            </button>
          )}
        </div>
      </dl>

      {open && hasCategories && (
        <div className={styles.categories}>
          <CategoryList title="支出" categories={summary.expenseCategories} total={summary.expense.total} money={money} />
          <CategoryList title="收入" categories={summary.incomeCategories} total={summary.income} money={money} />
        </div>
      )}
    </section>
  )
}

type ListProps = {
  title: string
  categories: SummaryCategory[]
  total: number
  money: (amount: number) => string
}

// 一欄分類:上層(含子分類)與佔該欄合計的比例,子分類縮排在下面
function CategoryList({ title, categories, total, money }: ListProps) {
  if (!categories.length) return null
  const share = (amount: number) => (total > 0 ? `${Math.round((amount / total) * 100)}%` : '')
  return (
    <table className={styles.table}>
      <caption className={styles.caption}>{title}</caption>
      <tbody>
        {categories.flatMap((category) => [
          <tr key={category.id}>
            <th scope="row">{category.name}</th>
            <td className={styles.amount}>{money(category.amount)}</td>
            <td className={styles.share}>{share(category.amount)}</td>
          </tr>,
          ...category.children.map((child) => (
            <tr key={child.id} className={styles.child}>
              <th scope="row">{child.name}</th>
              <td className={styles.amount}>{money(child.amount)}</td>
              <td className={styles.share} />
            </tr>
          )),
        ])}
      </tbody>
    </table>
  )
}
