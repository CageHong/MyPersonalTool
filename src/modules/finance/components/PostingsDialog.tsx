'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { editErrorMessage, patchJson } from '../lib/api'
import type { PostingInput } from '../lib/edit'
import { amountInputValue, formatMoney, parseAmount } from '../lib/money'
import type { AccountType, FinanceLookups, TransactionRow } from '../lib/transactions'
import styles from './PostingsDialog.module.css'

// 分錄編輯的對話框:整組替換一筆交易的分錄(拆帳、改成轉帳、收回保證金或代墊…)。
// 金額分借、貸兩欄(跟展開列的分錄表一致),下方即時顯示各幣別的差額;每個幣別都平衡才能儲存。
// 由右欄打開,關掉就卸載(父層決定要不要渲染)

type Line = {
  key: number
  accountId: number
  currency: string
  debit: string
  credit: string
  memo: string
}

type Props = {
  row: TransactionRow
  lookups: FinanceLookups
  onClose: () => void
  onSaved: (row: TransactionRow) => void
}

const TYPE_GROUPS: { type: AccountType; label: string }[] = [
  { type: 'asset', label: '資產' },
  { type: 'liability', label: '負債' },
  { type: 'expense', label: '支出' },
  { type: 'income', label: '收入' },
  { type: 'equity', label: '權益' },
]

let nextKey = 1

function linesOf(row: TransactionRow, exponents: Record<string, number>): Line[] {
  return row.postings.map((p) => ({
    key: nextKey++,
    accountId: p.accountId,
    currency: p.currency,
    debit: p.amount > 0 ? amountInputValue(p.amount, exponents[p.currency] ?? 2) : '',
    credit: p.amount < 0 ? amountInputValue(-p.amount, exponents[p.currency] ?? 2) : '',
    memo: p.memo ?? '',
  }))
}

// 一行的金額(正 = 借、負 = 貸);空白、兩欄都填、不是數字、超過小數位數時是 null
function amountOf(line: Line, exponents: Record<string, number>): number | null {
  const exponent = exponents[line.currency] ?? 2
  const debit = line.debit.trim()
  const credit = line.credit.trim()
  if ((debit === '') === (credit === '')) return null
  const value = parseAmount(debit || credit, exponent)
  if (value === null || value <= 0) return null
  return debit ? value : -value
}

function setAmount(line: Line, amount: number, exponents: Record<string, number>): Line {
  const exponent = exponents[line.currency] ?? 2
  if (amount === 0) return { ...line, debit: '', credit: '' }
  return amount > 0
    ? { ...line, debit: amountInputValue(amount, exponent), credit: '' }
    : { ...line, debit: '', credit: amountInputValue(-amount, exponent) }
}

export default function PostingsDialog({ row, lookups, onClose, onSaved }: Props) {
  const { exponents, accounts } = lookups
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const [lines, setLines] = useState<Line[]>(() => linesOf(row, exponents))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  const accountById = new Map(accounts.map((a) => [a.id, a]))
  const currencies = Object.keys(exponents).sort()
  const amounts = lines.map((line) => amountOf(line, exponents))

  // 各幣別的差額(只算金額合法的行)
  const totals = new Map<string, number>()
  lines.forEach((line, index) => {
    totals.set(line.currency, (totals.get(line.currency) ?? 0) + (amounts[index] ?? 0))
  })
  const imbalances = [...totals].filter(([, total]) => total !== 0)
  const valid = lines.length >= 2 && amounts.every((a) => a !== null) && imbalances.length === 0

  // 匯入的交易:資產 / 負債那一側(每個帳戶的合計)變了,下次匯入會列為「金額不同」
  const sideKey = (items: { accountId: number; currency: string; amount: number }[]) => {
    const sums = new Map<string, number>()
    for (const item of items) {
      const type = accountById.get(item.accountId)?.type
      if (type !== 'asset' && type !== 'liability') continue
      const key = `${item.accountId}:${item.currency}`
      sums.set(key, (sums.get(key) ?? 0) + item.amount)
    }
    return [...sums].filter(([, sum]) => sum !== 0).map(([key, sum]) => `${key}:${sum}`).sort().join('|')
  }
  const sideChanged =
    row.source !== 'manual' &&
    sideKey(row.postings) !==
      sideKey(lines.map((line, index) => ({ accountId: line.accountId, currency: line.currency, amount: amounts[index] ?? 0 })))

  function update(key: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)))
  }

  function changeAccount(line: Line, accountId: number) {
    const fixed = accountById.get(accountId)?.currency
    update(line.key, fixed ? { accountId, currency: fixed } : { accountId })
  }

  // 這一行吸收自己幣別的差額
  function absorb(line: Line, index: number) {
    const total = totals.get(line.currency) ?? 0
    const next = (amounts[index] ?? 0) - total
    setLines((prev) => prev.map((l) => (l.key === line.key ? setAmount(l, next, exponents) : l)))
  }

  // 拆開:在下面插一行同帳戶、同幣別、沒有金額的
  function split(line: Line) {
    setLines((prev) => {
      const index = prev.findIndex((l) => l.key === line.key)
      const copy: Line = { ...line, key: nextKey++, debit: '', credit: '', memo: '' }
      return [...prev.slice(0, index + 1), copy, ...prev.slice(index + 1)]
    })
  }

  function addLine() {
    const currency = lines[0]?.currency ?? currencies[0] ?? 'EUR'
    setLines((prev) => [
      ...prev,
      { key: nextKey++, accountId: lookups.system.uncategorizedExpense, currency, debit: '', credit: '', memo: '' },
    ])
  }

  function save() {
    if (!valid) return
    const postings: PostingInput[] = lines.map((line, index) => ({
      accountId: line.accountId,
      amount: amounts[index] as number,
      currency: line.currency,
      memo: line.memo.trim() || null,
    }))
    setSaving(true)
    setError(null)
    patchJson<TransactionRow>(`/api/finance/transactions/${row.id}`, { expectedUpdatedAt: row.updatedAt, postings })
      .then((saved) => {
        onSaved(saved)
        ref.current?.close()
      })
      .catch((caught: unknown) => {
        setError(editErrorMessage(caught))
        setSaving(false)
      })
  }

  // 帳戶選單:依類型分組;分類帶上層名稱;封存的只有目前選的那個列出來
  function accountOptions(current: number) {
    return TYPE_GROUPS.map(({ type, label }) => {
      const items = accounts
        .filter((a) => a.type === type && (a.isActive || a.id === current))
        .map((a) => {
          const parent = a.parentId !== null ? accountById.get(a.parentId)?.name : null
          return { id: a.id, label: parent ? `${parent} / ${a.name}` : a.name }
        })
        .sort((a, b) => a.label.localeCompare(b.label))
      if (!items.length) return null
      return (
        <optgroup key={type} label={label}>
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </optgroup>
      )
    })
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={styles.dialog}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) ref.current.close()
      }}
    >
      <form
        className={styles.content}
        onSubmit={(event) => {
          event.preventDefault()
          if (!saving) save()
        }}
      >
        <h2 id={titleId} className={styles.title}>
          編輯分錄
        </h2>

        <table className={styles.table}>
          <thead>
            <tr>
              <th>帳戶</th>
              <th>幣別</th>
              <th className={styles.right}>借</th>
              <th className={styles.right}>貸</th>
              <th>備註</th>
              <th>
                <span className={styles.visuallyHidden}>操作</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => {
              const account = accountById.get(line.accountId)
              const invalid = amounts[index] === null && (line.debit.trim() !== '' || line.credit.trim() !== '')
              const imbalance = totals.get(line.currency) ?? 0
              return (
                <tr key={line.key}>
                  <td>
                    <select
                      className={styles.field}
                      aria-label={`第 ${index + 1} 行的帳戶`}
                      value={line.accountId}
                      onChange={(event) => changeAccount(line, Number(event.target.value))}
                    >
                      {accountOptions(line.accountId)}
                    </select>
                  </td>
                  <td>
                    {account?.currency ? (
                      <span className={styles.muted}>{line.currency}</span>
                    ) : (
                      <select
                        className={styles.field}
                        aria-label={`第 ${index + 1} 行的幣別`}
                        value={line.currency}
                        onChange={(event) => update(line.key, { currency: event.target.value })}
                      >
                        {currencies.map((code) => (
                          <option key={code} value={code}>
                            {code}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td>
                    <input
                      className={`${styles.field} ${styles.amount}`}
                      inputMode="decimal"
                      aria-label={`第 ${index + 1} 行的借方金額`}
                      aria-invalid={invalid || undefined}
                      value={line.debit}
                      onChange={(event) => update(line.key, { debit: event.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      className={`${styles.field} ${styles.amount}`}
                      inputMode="decimal"
                      aria-label={`第 ${index + 1} 行的貸方金額`}
                      aria-invalid={invalid || undefined}
                      value={line.credit}
                      onChange={(event) => update(line.key, { credit: event.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      className={styles.field}
                      aria-label={`第 ${index + 1} 行的備註`}
                      value={line.memo}
                      onChange={(event) => update(line.key, { memo: event.target.value })}
                    />
                  </td>
                  <td className={styles.lineActions}>
                    <button
                      type="button"
                      className={styles.small}
                      disabled={imbalance === 0}
                      onClick={() => absorb(line, index)}
                    >
                      補差額
                    </button>
                    <button type="button" className={styles.small} onClick={() => split(line)}>
                      拆開
                    </button>
                    <button
                      type="button"
                      className={styles.remove}
                      aria-label={`刪除第 ${index + 1} 行`}
                      disabled={lines.length <= 2}
                      onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        <div className={styles.below}>
          <button type="button" className={styles.small} onClick={addLine}>
            加一行
          </button>
          <div className={styles.balance} role="status">
            {amounts.some((a) => a === null) && <span className={styles.error}>有金額空白或不合法(每行借、貸只填一邊)。</span>}
            {imbalances.map(([currency, total]) => (
              <span key={currency} className={styles.error}>
                {currency} 差額 {formatMoney(Math.abs(total), currency, exponents)}({total > 0 ? '借方多' : '貸方多'})
              </span>
            ))}
            {valid && <span className={styles.muted}>借貸平衡</span>}
          </div>
        </div>

        {sideChanged && (
          <p className={styles.warning}>
            這筆是匯入的交易,資產 / 負債那一側的金額跟原本不同;下次匯入同一份檔案時會列為「金額不同」(只報告、不會改回來)。
          </p>
        )}
        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.footer}>
          <button type="button" className={styles.cancel} onClick={() => ref.current?.close()}>
            取消
          </button>
          <button type="submit" className={styles.primary} disabled={!valid || saving}>
            {saving ? '儲存中…' : '儲存分錄'}
          </button>
        </div>
      </form>
    </dialog>
  )
}
