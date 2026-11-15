'use client'

import { useEffect, useState } from 'react'
import { adminErrorMessage, getJson, loadErrorMessage, postJson, sendNoContent } from '../lib/api'
import { categoryOptions } from '../lib/accounts'
import { formatLocalDate } from '../lib/date'
import { NAME_MAX_LENGTH } from '../lib/edit'
import { formatMoney } from '../lib/money'
import type { ReclassifyPreview, RuleRow } from '../lib/rules'
import type { FinanceLookups } from '../lib/transactions'
import PayeePicker from './PayeePicker'
import styles from './AdminPage.module.css'

// 規則管理:對象規則(付出,指到支出分類)、來源分類規則(指到支出或收入分類)兩區,
// 可以新增、改分類、停用、排優先順序、刪除。下方「重新分類未分類的交易」先預覽、勾選後才寫入

const URL = '/api/finance/rules'
const SOURCE_LABELS: Record<string, string> = {
  scheduled: '週期項目',
  rule: '對象規則',
  payee_history: '對象歷史',
  source_category: '來源分類規則',
}

export default function RulesPage() {
  const [rules, setRules] = useState<RuleRow[] | null>(null)
  const [lookups, setLookups] = useState<FinanceLookups | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([
      getJson<{ rules: RuleRow[] }>(URL, controller.signal),
      getJson<FinanceLookups>('/api/finance/lookups', controller.signal),
    ])
      .then(([result, lk]) => {
        setRules(result.rules)
        setLookups(lk)
        setLoadError(null)
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setLoadError(loadErrorMessage(caught))
      })
    return () => controller.abort()
  }, [attempt])

  const reload = () => setAttempt((n) => n + 1)
  const run = (action: () => Promise<unknown>) => {
    setError(null)
    action()
      .then(reload)
      .catch((caught: unknown) => setError(adminErrorMessage(caught)))
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.heading}>規則</h1>
      </header>
      {loadError && (
        <p className={styles.error}>
          {loadError}{' '}
          <button type="button" className={styles.button} onClick={reload}>
            重試
          </button>
        </p>
      )}
      {(!rules || !lookups) && !loadError && <p className={styles.muted}>載入中…</p>}
      {error && <p className={styles.error}>{error}</p>}
      {rules && lookups && (
        <>
          <RuleSection
            title="對象規則"
            hint="付出的交易,收款人是這個就記到這個支出分類。同一個收款人有多條時,上面的優先。"
            matchField="payee"
            rules={rules.filter((r) => r.matchField === 'payee')}
            lookups={lookups}
            run={run}
          />
          <RuleSection
            title="來源分類規則"
            hint="Wise 給的分類(原文)是這個就記到這個分類。入帳指到支出分類 = 沖銷那個分類(退款、代墊收回)。"
            matchField="source_category"
            rules={rules.filter((r) => r.matchField === 'source_category')}
            lookups={lookups}
            run={run}
          />
          <Reclassify onApplied={reload} lookups={lookups} />
        </>
      )}
    </div>
  )
}

type SectionProps = {
  title: string
  hint: string
  matchField: 'payee' | 'source_category'
  rules: RuleRow[]
  lookups: FinanceLookups
  run: (action: () => Promise<unknown>) => void
}

function RuleSection({ title, hint, matchField, rules, lookups, run }: SectionProps) {
  const [payeeId, setPayeeId] = useState<number | undefined>(undefined)
  const [matchValue, setMatchValue] = useState('')
  const [accountId, setAccountId] = useState<number | ''>('')
  // 對象規則只能指到支出分類;來源分類規則兩種都可以
  const options =
    matchField === 'payee'
      ? categoryOptions(lookups, 'expense').map((o) => ({ ...o, group: '支出' }))
      : [
          ...categoryOptions(lookups, 'expense').map((o) => ({ ...o, group: '支出' })),
          ...categoryOptions(lookups, 'income').map((o) => ({ ...o, group: '收入' })),
        ]
  const optionList = (current: number | null) => {
    const list = [...options]
    if (current !== null && !list.some((o) => o.id === current)) {
      const account = lookups.accounts.find((a) => a.id === current)
      list.push({ id: current, label: `${account?.name ?? `#${current}`}(封存)`, currency: null, group: '其他' })
    }
    return ['支出', '收入', '其他'].map((group) => {
      const items = list.filter((o) => o.group === group)
      return items.length ? (
        <optgroup key={group} label={group}>
          {items.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </optgroup>
      ) : null
    })
  }
  const canAdd = accountId !== '' && (matchField === 'payee' ? payeeId !== undefined : matchValue.trim() !== '')

  return (
    <section className={styles.section} aria-label={title}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      <p className={styles.muted}>{hint}</p>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>{matchField === 'payee' ? '收款人' : '來源分類'}</th>
            <th>記到</th>
            <th>啟用</th>
            <th>
              <span className={styles.muted}>順序 / 刪除</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rules.map((rule, index) => (
            <tr key={rule.id} className={rule.isActive ? undefined : styles.archived}>
              <td>{matchField === 'payee' ? rule.payeeName : rule.matchValue}</td>
              <td>
                <select
                  className={styles.input}
                  aria-label="記到哪個分類"
                  value={rule.assignAccountId ?? ''}
                  onChange={(event) =>
                    run(() => sendNoContent('PATCH', `${URL}/${rule.id}`, { assignAccountId: Number(event.target.value) }))
                  }
                >
                  {optionList(rule.assignAccountId)}
                </select>
              </td>
              <td>
                <input
                  type="checkbox"
                  aria-label="啟用"
                  checked={rule.isActive}
                  onChange={(event) => run(() => sendNoContent('PATCH', `${URL}/${rule.id}`, { isActive: event.target.checked }))}
                />
              </td>
              <td>
                <div className={styles.row}>
                  <button
                    type="button"
                    className={styles.button}
                    aria-label="上移"
                    disabled={index === 0}
                    onClick={() => run(() => sendNoContent('POST', `${URL}/${rule.id}/move`, { direction: 'up' }))}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className={styles.button}
                    aria-label="下移"
                    disabled={index === rules.length - 1}
                    onClick={() => run(() => sendNoContent('POST', `${URL}/${rule.id}/move`, { direction: 'down' }))}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className={styles.button}
                    onClick={() => run(() => sendNoContent('DELETE', `${URL}/${rule.id}`))}
                  >
                    刪除
                  </button>
                </div>
              </td>
            </tr>
          ))}
          {rules.length === 0 && (
            <tr>
              <td colSpan={4} className={styles.muted}>
                還沒有規則
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <form
        className={styles.inlineForm}
        onSubmit={(event) => {
          event.preventDefault()
          if (!canAdd) return
          run(() =>
            postJson(URL, {
              matchField,
              payeeId: matchField === 'payee' ? payeeId : null,
              matchValue: matchField === 'source_category' ? matchValue : null,
              assignAccountId: accountId,
            }).then(() => {
              setPayeeId(undefined)
              setMatchValue('')
              setAccountId('')
            }),
          )
        }}
      >
        {matchField === 'payee' ? (
          <PayeePicker payees={lookups.payees} value={payeeId} placeholder="選收款人" onChange={setPayeeId} />
        ) : (
          <input
            className={styles.input}
            placeholder="來源分類(原文)"
            aria-label="來源分類"
            maxLength={NAME_MAX_LENGTH}
            value={matchValue}
            onChange={(event) => setMatchValue(event.target.value)}
          />
        )}
        <select
          className={styles.input}
          aria-label="記到哪個分類"
          value={accountId}
          onChange={(event) => setAccountId(event.target.value === '' ? '' : Number(event.target.value))}
        >
          <option value="">(選分類)</option>
          {optionList(null)}
        </select>
        <button type="submit" className={styles.button} disabled={!canAdd}>
          新增規則
        </button>
      </form>
    </section>
  )
}

function Reclassify({ onApplied, lookups }: { onApplied: () => void; lookups: FinanceLookups }) {
  const [preview, setPreview] = useState<ReclassifyPreview | null>(null)
  const [chosen, setChosen] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function load() {
    setBusy(true)
    setError(null)
    setMessage(null)
    getJson<ReclassifyPreview>(`${URL}/reclassify`)
      .then((result) => {
        setPreview(result)
        setChosen(new Set(result.items.map((i) => i.transactionId)))
      })
      .catch((caught: unknown) => setError(loadErrorMessage(caught)))
      .finally(() => setBusy(false))
  }

  function apply() {
    setBusy(true)
    setError(null)
    postJson<{ applied: number; skipped: number }>(`${URL}/reclassify`, { transactionIds: [...chosen] })
      .then((result) => {
        setMessage(`已分類 ${result.applied} 筆${result.skipped ? `,略過 ${result.skipped} 筆(已經不是未分類)` : ''}。`)
        setPreview(null)
        onApplied()
      })
      .catch((caught: unknown) => setError(adminErrorMessage(caught)))
      .finally(() => setBusy(false))
  }

  return (
    <section className={styles.section} aria-label="重新分類未分類的交易">
      <h2 className={styles.sectionTitle}>重新分類未分類的交易</h2>
      <p className={styles.muted}>用目前的規則、週期項目、對象歷史,為還記在「未分類」的交易決定分類。已經分類的交易不動。</p>
      <div className={styles.row}>
        <button type="button" className={styles.button} onClick={load} disabled={busy}>
          {preview ? '重新預覽' : '預覽'}
        </button>
        {preview && (
          <button type="button" className={styles.primary} onClick={apply} disabled={busy || chosen.size === 0}>
            套用選中的 {chosen.size} 筆
          </button>
        )}
      </div>
      {message && <p className={styles.muted}>{message}</p>}
      {error && <p className={styles.error}>{error}</p>}
      {preview && (
        <>
          <p className={styles.muted}>
            會分類 {preview.items.length} 筆;另有 {preview.unmatched} 筆沒有命中,維持未分類。
          </p>
          {preview.items.length > 0 && (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      aria-label="全選"
                      checked={chosen.size === preview.items.length}
                      onChange={(event) =>
                        setChosen(event.target.checked ? new Set(preview.items.map((i) => i.transactionId)) : new Set())
                      }
                    />
                  </th>
                  <th>日期</th>
                  <th>對象</th>
                  <th className={styles.number}>金額</th>
                  <th>分到</th>
                  <th>依據</th>
                </tr>
              </thead>
              <tbody>
                {preview.items.map((item) => (
                  <tr key={item.transactionId}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`選取 ${formatLocalDate(item.occurredAt)} ${item.payee ?? ''}`}
                        checked={chosen.has(item.transactionId)}
                        onChange={(event) => {
                          const next = new Set(chosen)
                          if (event.target.checked) next.add(item.transactionId)
                          else next.delete(item.transactionId)
                          setChosen(next)
                        }}
                      />
                    </td>
                    <td>{formatLocalDate(item.occurredAt)}</td>
                    <td>{item.payee ?? '—'}</td>
                    <td className={styles.number}>{formatMoney(item.amount, item.currency, lookups.exponents)}</td>
                    <td>{item.accountName}</td>
                    <td className={styles.muted}>{SOURCE_LABELS[item.categorySource]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  )
}
