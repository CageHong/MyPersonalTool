'use client'

import { useEffect, useState } from 'react'
import { adminErrorMessage, getJson, loadErrorMessage, postJson, sendNoContent } from '../lib/api'
import { notifyLedgerChanged } from '../lib/ledger-events'
import { SUBTYPES } from '../lib/balance-accounts'
import type { BalanceAccountRow, BalanceAccountType } from '../lib/balance-accounts'
import { NAME_MAX_LENGTH } from '../lib/edit'
import { formatMoney } from '../lib/money'
import type { FinanceLookups } from '../lib/transactions'
import styles from './AdminPage.module.css'

// 資產 / 負債帳戶:新增、改名、改子類型、封存。幣別建立後不能改。群組、信用卡明細在里程碑 c

const URL = '/api/finance/accounts'
const TYPE_LABELS: Record<BalanceAccountType, string> = { asset: '資產', liability: '負債' }
const subtypeLabel = (type: BalanceAccountType, key: string | null) =>
  (SUBTYPES[type] as readonly { key: string; label: string }[]).find((s) => s.key === key)?.label ?? key ?? '—'

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<BalanceAccountRow[] | null>(null)
  const [exponents, setExponents] = useState<Record<string, number>>({})
  const [loadError, setLoadError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [selectedId, setSelectedId] = useState<number | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([
      getJson<{ accounts: BalanceAccountRow[] }>(URL, controller.signal),
      getJson<FinanceLookups>('/api/finance/lookups', controller.signal),
    ])
      .then(([result, lookups]) => {
        setAccounts(result.accounts)
        setExponents(lookups.exponents)
        setLoadError(null)
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setLoadError(loadErrorMessage(caught))
      })
    return () => controller.abort()
  }, [attempt])

  // 改了帳戶(新增、改名、封存)也通知側欄重新取
  const reload = () => {
    setAttempt((n) => n + 1)
    notifyLedgerChanged()
  }
  const selected = accounts?.find((a) => a.id === selectedId) ?? null

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.heading}>帳戶</h1>
      </header>
      {loadError && (
        <p className={styles.error}>
          {loadError}{' '}
          <button type="button" className={styles.button} onClick={reload}>
            重試
          </button>
        </p>
      )}
      {!accounts && !loadError && <p className={styles.muted}>載入中…</p>}
      {accounts && (
        <div className={styles.body}>
          <div className={styles.columns}>
            {(['asset', 'liability'] as const).map((type) => (
              <section key={type} className={styles.section} aria-label={`${TYPE_LABELS[type]}帳戶`}>
                <h2 className={styles.sectionTitle}>{TYPE_LABELS[type]}</h2>
                <NewAccount type={type} currencies={Object.keys(exponents).sort()} onCreated={reload} />
                <ul className={styles.list}>
                  {accounts
                    .filter((a) => a.type === type)
                    .map((a) => (
                      <li key={a.id}>
                        <button
                          type="button"
                          className={[styles.item, a.id === selectedId && styles.selected, !a.isActive && styles.archived]
                            .filter(Boolean)
                            .join(' ')}
                          aria-current={a.id === selectedId ? 'true' : undefined}
                          onClick={() => setSelectedId(a.id === selectedId ? null : a.id)}
                        >
                          <span>
                            {a.name}
                            {!a.isActive && '(封存)'}
                            <span className={styles.badge}>{subtypeLabel(a.type, a.subtype)}</span>
                          </span>
                          <span className={styles.count}>{formatMoney(a.balance, a.currency, exponents)}</span>
                        </button>
                      </li>
                    ))}
                </ul>
              </section>
            ))}
          </div>
          {selected && (
            <AccountPanel key={selected.id} account={selected} exponents={exponents} onChanged={reload} onClose={() => setSelectedId(null)} />
          )}
        </div>
      )}
    </div>
  )
}

function NewAccount({ type, currencies, onCreated }: { type: BalanceAccountType; currencies: string[]; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [subtype, setSubtype] = useState<string>(SUBTYPES[type][0].key)
  const [currency, setCurrency] = useState(currencies.includes('EUR') ? 'EUR' : (currencies[0] ?? ''))
  const [error, setError] = useState<string | null>(null)
  return (
    <form
      className={styles.inlineForm}
      onSubmit={(event) => {
        event.preventDefault()
        if (!name.trim()) return
        setError(null)
        postJson(URL, { name, type, subtype, currency })
          .then(() => {
            setName('')
            onCreated()
          })
          .catch((caught: unknown) => setError(adminErrorMessage(caught)))
      }}
    >
      <input
        className={styles.input}
        placeholder={`新增${TYPE_LABELS[type]}帳戶`}
        aria-label={`新增${TYPE_LABELS[type]}帳戶的名稱`}
        maxLength={NAME_MAX_LENGTH}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <select className={styles.input} aria-label="子類型" value={subtype} onChange={(event) => setSubtype(event.target.value)}>
        {SUBTYPES[type].map((s) => (
          <option key={s.key} value={s.key}>
            {s.label}
          </option>
        ))}
      </select>
      <select className={styles.input} aria-label="幣別" value={currency} onChange={(event) => setCurrency(event.target.value)}>
        {currencies.map((code) => (
          <option key={code} value={code}>
            {code}
          </option>
        ))}
      </select>
      <button type="submit" className={styles.button} disabled={!name.trim()}>
        新增
      </button>
      {error && <span className={styles.error}>{error}</span>}
    </form>
  )
}

type PanelProps = {
  account: BalanceAccountRow
  exponents: Record<string, number>
  onChanged: () => void
  onClose: () => void
}

function AccountPanel({ account, exponents, onChanged, onClose }: PanelProps) {
  const [name, setName] = useState(account.name)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const item = `${URL}/${account.id}`

  function run(body: Record<string, unknown>) {
    setBusy(true)
    setError(null)
    sendNoContent('PATCH', item, body)
      .then(onChanged)
      .catch((caught: unknown) => setError(adminErrorMessage(caught)))
      .finally(() => setBusy(false))
  }

  return (
    <aside className={styles.panel} aria-label={`帳戶 ${account.name}`}>
      <header className={styles.panelHeader}>
        <h2 className={styles.sectionTitle}>{account.name}</h2>
        <button type="button" className={styles.close} aria-label="關閉" onClick={onClose}>
          ×
        </button>
      </header>
      <p className={styles.muted}>
        {TYPE_LABELS[account.type]} · {account.currency} · 餘額 {formatMoney(account.balance, account.currency, exponents)} ·{' '}
        {account.transactions} 筆交易
      </p>

      <form
        className={styles.field}
        onSubmit={(event) => {
          event.preventDefault()
          if (name.trim() && name !== account.name) run({ name })
        }}
      >
        <label className={styles.label} htmlFor="account-name">
          名稱
        </label>
        <div className={styles.row}>
          <input
            id="account-name"
            className={styles.input}
            maxLength={NAME_MAX_LENGTH}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <button type="submit" className={styles.button} disabled={busy || !name.trim() || name === account.name}>
            改名
          </button>
        </div>
      </form>

      <label className={styles.field}>
        <span className={styles.label}>子類型</span>
        <select
          className={styles.input}
          value={account.subtype ?? ''}
          disabled={busy}
          onChange={(event) => run({ subtype: event.target.value })}
        >
          {account.subtype === null && <option value="">—</option>}
          {SUBTYPES[account.type].map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </label>

      <div className={styles.field}>
        <span className={styles.label}>封存</span>
        <span className={styles.muted}>封存後新增交易、分錄編輯的帳戶選單裡選不到,舊交易照常顯示。幣別不能改。</span>
        <div className={styles.row}>
          <button type="button" className={styles.button} disabled={busy} onClick={() => run({ isActive: !account.isActive })}>
            {account.isActive ? '封存' : '取消封存'}
          </button>
        </div>
      </div>

      {error && <p className={styles.error}>{error}</p>}
    </aside>
  )
}
