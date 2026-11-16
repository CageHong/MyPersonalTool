'use client'

import { Fragment } from 'react'
import { formatLocalDate } from '../lib/date'
import { formatMoney } from '../lib/money'
import { KIND_LABELS } from '../lib/transactions'
import type { AccountType, FinanceLookups, TransactionRow } from '../lib/transactions'
import styles from './TransactionTable.module.css'

// 交易清單的表格:一筆交易一列,點那一列任何地方展開看備註與全部分錄(鍵盤用日期按鈕)。只顯示,不改資料

const SOURCE_LABELS: Record<string, string> = {
  wise_csv: 'Wise CSV',
  manual: '手動',
  migration: '舊版遷移',
  scheduled: '週期項目',
}

const CATEGORY_SOURCE_LABELS: Record<string, string> = {
  legacy: '舊版的分類',
  scheduled: '週期項目',
  rule: '對象規則',
  payee_history: '對象歷史',
  source_category: '來源分類規則',
  correction: '人工更正',
  manual: '手動',
}

const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  asset: '資產',
  liability: '負債',
  equity: '權益',
  income: '收入',
  expense: '支出',
}

type Props = {
  rows: TransactionRow[]
  lookups: FinanceLookups
  expandedId: number | null
  // 正在編輯的那一列(標示選取)
  editingId: number | null
  onToggle: (id: number) => void
  onEdit: (id: number) => void
}

// 分類欄:有損益的交易列分類(子分類帶上層);轉帳、換匯、期初餘額列類型
function categoryText(row: TransactionRow): string {
  if (row.kind !== 'expense' && row.kind !== 'income' && row.kind !== 'mixed') return KIND_LABELS[row.kind]
  return row.categories.map((c) => (c.parentName ? `${c.parentName} / ${c.name}` : c.name)).join('、')
}

export default function TransactionTable({ rows, lookups, expandedId, editingId, onToggle, onEdit }: Props) {
  const { exponents, displayCurrency } = lookups
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>日期</th>
            <th>對象</th>
            <th>分類</th>
            <th>帳戶</th>
            <th className={styles.right}>金額</th>
            <th className={styles.right}>折合 {displayCurrency}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const expanded = expandedId === row.id
            const rowClass = [styles.row, expanded && styles.expanded, editingId === row.id && styles.editing]
              .filter(Boolean)
              .join(' ')
            return (
              <Fragment key={row.id}>
                <tr
                  className={rowClass}
                  aria-current={editingId === row.id ? 'true' : undefined}
                  onClick={() => {
                    // 拖曳選取文字(例如複製對象名稱)時不展開
                    if (window.getSelection()?.toString()) return
                    onToggle(row.id)
                  }}
                >
                  <td className={styles.date}>
                    {/* 給鍵盤與螢幕報讀器用的展開按鈕;滑鼠點整列由上面的 onClick 處理,這裡不再往上傳 */}
                    <button
                      type="button"
                      className={styles.toggle}
                      aria-expanded={expanded}
                      aria-controls={`tx-${row.id}`}
                      onClick={(event) => {
                        event.stopPropagation()
                        onToggle(row.id)
                      }}
                    >
                      {formatLocalDate(row.occurredAt)}
                    </button>
                  </td>
                  <td className={styles.payee}>
                    <span>{row.payee?.name ?? '—'}</span>
                  </td>
                  <td>
                    <span>{categoryText(row)}</span>
                    {row.tags.length > 0 && (
                      <span className={styles.tags}>
                        {row.tags.map((tag) => (
                          <span key={tag.id} className={styles.tag}>
                            {tag.name}
                          </span>
                        ))}
                      </span>
                    )}
                  </td>
                  <td>
                    {row.legs.map((leg) => (
                      <div key={leg.accountId}>{leg.accountName}</div>
                    ))}
                  </td>
                  <td className={`${styles.amount} ${styles.right}`}>
                    {row.legs.map((leg) => (
                      <div key={leg.accountId}>{formatMoney(leg.amount, leg.currency, exponents)}</div>
                    ))}
                  </td>
                  <td className={`${styles.amount} ${styles.right} ${styles.muted}`}>
                    {row.displayAmount === null ? '' : formatMoney(row.displayAmount, displayCurrency, exponents)}
                  </td>
                </tr>
                {expanded && (
                  <tr id={`tx-${row.id}`} className={styles.detailRow}>
                    <td colSpan={6}>
                      <TransactionDetail row={row} exponents={exponents} onEdit={() => onEdit(row.id)} />
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

type DetailProps = { row: TransactionRow; exponents: Record<string, number>; onEdit: () => void }

function TransactionDetail({ row, exponents, onEdit }: DetailProps) {
  return (
    <div className={styles.detail}>
      {row.note && (
        <p className={styles.noteBlock}>
          <span className={styles.muted}>備註</span> {row.note}
        </p>
      )}
      <button type="button" className={styles.edit} onClick={onEdit}>
        編輯
      </button>
      <table className={styles.postings}>
        <thead>
          <tr>
            <th>帳戶</th>
            <th>種類</th>
            <th className={styles.right}>借</th>
            <th className={styles.right}>貸</th>
            <th>備註</th>
          </tr>
        </thead>
        <tbody>
          {row.postings.map((p) => (
            <tr key={p.id}>
              <td>{p.accountName}</td>
              <td className={styles.muted}>{ACCOUNT_TYPE_LABELS[p.accountType]}</td>
              <td className={`${styles.amount} ${styles.right}`}>
                {p.amount > 0 ? formatMoney(p.amount, p.currency, exponents) : ''}
              </td>
              <td className={`${styles.amount} ${styles.right}`}>
                {p.amount < 0 ? formatMoney(-p.amount, p.currency, exponents) : ''}
              </td>
              <td className={styles.muted}>{p.memo ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className={styles.meta}>
        <dt>來源</dt>
        <dd>{SOURCE_LABELS[row.source] ?? row.source}</dd>
        {row.categorySource && (
          <>
            <dt>分類來自</dt>
            <dd>{CATEGORY_SOURCE_LABELS[row.categorySource] ?? row.categorySource}</dd>
          </>
        )}
        <dt>交易編號</dt>
        <dd>{row.id}</dd>
      </dl>
    </div>
  )
}
