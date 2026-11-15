'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { editErrorMessage, getJson, loadErrorMessage, postJson } from '../lib/api'
import { balanceAccountOptions, categoryOptions } from '../lib/accounts'
import { fromLocalInputValue, localToday, toLocalInputValue } from '../lib/date'
import { NAME_MAX_LENGTH, NOTE_MAX_LENGTH } from '../lib/edit'
import type { NewTransactionInput, PayeeChange } from '../lib/edit'
import { formatMoney, parseAmount } from '../lib/money'
import { TEMPLATES, buildTemplatePostings, reconcileCategoryType } from '../lib/templates'
import type { TemplateKey, TemplateValues } from '../lib/templates'
import type { FinanceLookups, TransactionRow } from '../lib/transactions'
import PayeePicker from './PayeePicker'
import styles from './NewTransactionDialog.module.css'

// 新增交易:選範本(支出、收入、轉帳、換匯、對帳調整)填表,範本把表單變成一組平衡的分錄後送出。
// 存好之後就是一般的交易,父層會打開右欄,要拆帳、加手續費就用「編輯分錄…」

type Props = {
  lookups: FinanceLookups
  onClose: () => void
  onCreated: (row: TransactionRow) => void
}

type Balance = { key: string; amount: number | null; error: string | null }

export default function NewTransactionDialog({ lookups, onClose, onCreated }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const accounts = balanceAccountOptions(lookups)
  const firstAccount = accounts[0]?.id ?? 0

  const [template, setTemplate] = useState<TemplateKey>('expense')
  const [when, setWhen] = useState(() => toLocalInputValue(new Date().toISOString()).slice(0, 16))
  const [date, setDate] = useState(() => localToday())
  const [accountId, setAccountId] = useState(firstAccount)
  const [toId, setToId] = useState(accounts[1]?.id ?? firstAccount)
  const [amount, setAmount] = useState('')
  const [toAmount, setToAmount] = useState('')
  const [actual, setActual] = useState('')
  const [expenseCategory, setExpenseCategory] = useState(lookups.system.uncategorizedExpense)
  const [incomeCategory, setIncomeCategory] = useState(lookups.system.uncategorizedIncome)
  const [payeeId, setPayeeId] = useState<number | null>(null)
  const [newPayee, setNewPayee] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [balance, setBalance] = useState<Balance | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  const currencyOf = (id: number) => lookups.accounts.find((a) => a.id === id)?.currency ?? 'EUR'
  const exponentOf = (id: number) => lookups.exponents[currencyOf(id)] ?? 2
  const parse = (text: string, id: number) => (text.trim() === '' ? null : parseAmount(text, exponentOf(id)))

  // 對帳調整:那一天結束時的帳上餘額
  const balanceKey = `${accountId}:${date}`
  useEffect(() => {
    if (template !== 'reconcile' || !accountId) return
    const controller = new AbortController()
    getJson<{ amount: number }>(`/api/finance/accounts/${accountId}/balance?asOf=${date}`, controller.signal)
      .then((result) => setBalance({ key: balanceKey, amount: result.amount, error: null }))
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setBalance({ key: balanceKey, amount: null, error: loadErrorMessage(caught) })
      })
    return () => controller.abort()
  }, [template, accountId, date, balanceKey])
  const ledgerBalance = balance?.key === balanceKey ? balance : null
  const actualAmount = parse(actual, accountId)
  const difference =
    ledgerBalance?.amount != null && actualAmount !== null ? actualAmount - ledgerBalance.amount : null
  const reconcileType = difference !== null ? reconcileCategoryType(difference) : 'expense'

  // 表單 → 範本的值;還沒填好時是錯誤訊息
  function values(): TemplateValues | string {
    const main = parse(amount, accountId)
    switch (template) {
      case 'expense':
      case 'income':
        if (main === null) return '請輸入金額。'
        return {
          template,
          accountId,
          amount: main,
          categoryId: template === 'expense' ? expenseCategory : incomeCategory,
        }
      case 'transfer':
        if (main === null) return '請輸入金額。'
        return { template, fromId: accountId, toId, amount: main }
      case 'exchange': {
        const other = parse(toAmount, toId)
        if (main === null || other === null) return '請輸入兩邊的金額。'
        return { template, fromId: accountId, fromAmount: main, toId, toAmount: other }
      }
      case 'reconcile':
        if (actualAmount === null) return '請輸入實際餘額。'
        if (difference === null) return ledgerBalance?.error ?? '正在取得帳上餘額…'
        return {
          template,
          accountId,
          difference,
          categoryId: reconcileType === 'expense' ? expenseCategory : incomeCategory,
        }
    }
  }

  function occurredAt(): string | null {
    // 對帳調整記在那一天的最後一刻(跟帳上餘額一樣以 UTC 切日)
    if (template === 'reconcile') return /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T23:59:59Z` : null
    return fromLocalInputValue(when)
  }

  function save() {
    const v = values()
    if (typeof v === 'string') return setError(v)
    const built = buildTemplatePostings(v, lookups)
    if (!built.ok) return setError(built.error)
    const at = occurredAt()
    if (!at) return setError('日期時間不合法。')
    const payee: PayeeChange =
      template === 'expense' || template === 'income'
        ? newPayee !== null
          ? { name: newPayee }
          : payeeId !== null
            ? { id: payeeId }
            : null
        : null
    const input: NewTransactionInput = {
      occurredAt: at,
      payee,
      note: note.trim() || (template === 'reconcile' ? '對帳調整' : null),
      postings: built.postings,
    }
    setSaving(true)
    setError(null)
    postJson<TransactionRow>('/api/finance/transactions', input)
      .then((row) => {
        onCreated(row)
        ref.current?.close()
      })
      .catch((caught: unknown) => {
        setError(editErrorMessage(caught))
        setSaving(false)
      })
  }

  const accountSelect = (label: string, value: number, onChange: (id: number) => void) => (
    <label className={styles.field}>
      <span className={styles.label}>{label}</span>
      <select className={styles.input} value={value} onChange={(event) => onChange(Number(event.target.value))}>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.label}
          </option>
        ))}
      </select>
    </label>
  )

  const amountInput = (label: string, value: string, onChange: (text: string) => void, id: number) => (
    <label className={styles.field}>
      <span className={styles.label}>
        {label}({currencyOf(id)})
      </span>
      <input
        className={`${styles.input} ${styles.amount}`}
        inputMode="decimal"
        value={value}
        aria-invalid={value.trim() !== '' && parse(value, id) === null ? true : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )

  const categorySelect = (type: 'expense' | 'income') => (
    <label className={styles.field}>
      <span className={styles.label}>分類</span>
      <select
        className={styles.input}
        value={type === 'expense' ? expenseCategory : incomeCategory}
        onChange={(event) =>
          type === 'expense' ? setExpenseCategory(Number(event.target.value)) : setIncomeCategory(Number(event.target.value))
        }
      >
        {categoryOptions(lookups, type).map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )

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
          新增交易
        </h2>

        <div className={styles.templates} role="radiogroup" aria-label="範本">
          {TEMPLATES.map((t) => (
            <label key={t.key} className={template === t.key ? `${styles.template} ${styles.selected}` : styles.template}>
              <input
                type="radio"
                name="template"
                className={styles.radio}
                checked={template === t.key}
                onChange={() => {
                  setTemplate(t.key)
                  setError(null)
                }}
              />
              {t.label}
            </label>
          ))}
        </div>

        {template === 'reconcile' ? (
          <label className={styles.field}>
            <span className={styles.label}>日期(那一天結束時的餘額,以 UTC 切日)</span>
            <input className={styles.input} type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
        ) : (
          <label className={styles.field}>
            <span className={styles.label}>日期時間</span>
            <input
              className={styles.input}
              type="datetime-local"
              step={1}
              value={when}
              onChange={(event) => setWhen(event.target.value)}
            />
          </label>
        )}

        {(template === 'expense' || template === 'income') && (
          <>
            {accountSelect('帳戶', accountId, setAccountId)}
            {amountInput('金額', amount, setAmount, accountId)}
            {categorySelect(template)}
            <div className={styles.field}>
              <span className={styles.label}>對象</span>
              <PayeePicker
                payees={lookups.payees}
                value={payeeId ?? undefined}
                newName={newPayee}
                placeholder="沒有對象"
                fullWidth
                onChange={(id) => {
                  setPayeeId(id ?? null)
                  setNewPayee(null)
                }}
                onCreate={(name) => {
                  setPayeeId(null)
                  setNewPayee(name.slice(0, NAME_MAX_LENGTH))
                }}
              />
            </div>
          </>
        )}

        {template === 'transfer' && (
          <>
            {accountSelect('從', accountId, setAccountId)}
            {accountSelect('到', toId, setToId)}
            {amountInput('金額', amount, setAmount, accountId)}
          </>
        )}

        {template === 'exchange' && (
          <div className={styles.columns}>
            <div className={styles.column}>
              {accountSelect('從', accountId, setAccountId)}
              {amountInput('付出', amount, setAmount, accountId)}
            </div>
            <div className={styles.column}>
              {accountSelect('到', toId, setToId)}
              {amountInput('收到', toAmount, setToAmount, toId)}
            </div>
          </div>
        )}

        {template === 'reconcile' && (
          <>
            {accountSelect('帳戶', accountId, setAccountId)}
            {amountInput('實際餘額', actual, setActual, accountId)}
            <p className={styles.muted} role="status">
              {ledgerBalance === null
                ? '正在取得帳上餘額…'
                : ledgerBalance.error
                  ? ledgerBalance.error
                  : `帳上餘額 ${formatMoney(ledgerBalance.amount ?? 0, currencyOf(accountId), lookups.exponents)}` +
                    (difference !== null
                      ? difference === 0
                        ? ',跟實際一樣,不用調整'
                        : `,差額 ${formatMoney(difference, currencyOf(accountId), lookups.exponents)}(記到${reconcileType === 'expense' ? '支出' : '收入'}分類)`
                      : '')}
            </p>
            {difference !== null && difference !== 0 && categorySelect(reconcileType)}
          </>
        )}

        <label className={styles.field}>
          <span className={styles.label}>備註</span>
          <input
            className={styles.input}
            maxLength={NOTE_MAX_LENGTH}
            placeholder={template === 'reconcile' ? '對帳調整' : undefined}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>

        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.footer}>
          <button type="button" className={styles.cancel} onClick={() => ref.current?.close()}>
            取消
          </button>
          <button type="submit" className={styles.primary} disabled={saving}>
            {saving ? '新增中…' : '新增'}
          </button>
        </div>
      </form>
    </dialog>
  )
}
