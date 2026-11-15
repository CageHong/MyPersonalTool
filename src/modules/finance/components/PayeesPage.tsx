'use client'

import { useEffect, useRef, useState } from 'react'
import { adminErrorMessage, getJson, loadErrorMessage, sendNoContent } from '../lib/api'
import { NAME_MAX_LENGTH } from '../lib/edit'
import type { PayeeAdminRow } from '../lib/payees'
import ConfirmDialog from './ConfirmDialog'
import PayeePicker from './PayeePicker'
import styles from './AdminPage.module.css'

// 收款人管理:清單(搜尋、交易筆數)→ 右欄改名、別名(移到別人、刪除)、合併、刪除。
// 合併 = 交易、別名、規則、週期項目改指向目標,再刪掉來源;取代 import-v2.json 的 payeeMerges

const URL = '/api/finance/payees'

export default function PayeesPage() {
  const [payees, setPayees] = useState<PayeeAdminRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    getJson<{ payees: PayeeAdminRow[] }>(URL, controller.signal)
      .then((result) => {
        setPayees(result.payees)
        setLoadError(null)
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setLoadError(loadErrorMessage(caught))
      })
    return () => controller.abort()
  }, [attempt])

  const reload = () => setAttempt((n) => n + 1)
  const selected = payees?.find((p) => p.id === selectedId) ?? null
  const q = query.trim().toLowerCase()
  const visible = (payees ?? []).filter(
    (p) => !q || p.name.toLowerCase().includes(q) || p.aliases.some((a) => a.includes(q)),
  )

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.heading}>收款人</h1>
        {payees && <span className={styles.muted}>{payees.length} 個</span>}
      </header>
      {loadError && (
        <p className={styles.error}>
          {loadError}{' '}
          <button type="button" className={styles.button} onClick={reload}>
            重試
          </button>
        </p>
      )}
      {!payees && !loadError && <p className={styles.muted}>載入中…</p>}
      {payees && (
        <div className={styles.body}>
          <section className={styles.section} aria-label="收款人清單">
            <input
              className={styles.input}
              type="search"
              placeholder="搜尋名稱或別名"
              aria-label="搜尋收款人"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <ul className={styles.list}>
              {visible.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className={p.id === selectedId ? `${styles.item} ${styles.selected}` : styles.item}
                    aria-current={p.id === selectedId ? 'true' : undefined}
                    onClick={() => setSelectedId(p.id === selectedId ? null : p.id)}
                  >
                    <span>
                      {p.name}
                      {p.aliases.length > 1 && <span className={styles.badge}>{p.aliases.length} 個別名</span>}
                    </span>
                    <span className={styles.count}>{p.transactionCount}</span>
                  </button>
                </li>
              ))}
              {visible.length === 0 && <li className={styles.muted}>沒有符合的收款人</li>}
            </ul>
          </section>
          {selected && (
            <PayeePanel
              key={selected.id}
              payee={selected}
              payees={payees}
              onChanged={reload}
              onRemoved={() => {
                setSelectedId(null)
                reload()
              }}
              onClose={() => setSelectedId(null)}
            />
          )}
        </div>
      )}
    </div>
  )
}

type PanelProps = {
  payee: PayeeAdminRow
  payees: PayeeAdminRow[]
  onChanged: () => void
  onRemoved: () => void
  onClose: () => void
}

function PayeePanel({ payee, payees, onChanged, onRemoved, onClose }: PanelProps) {
  const [name, setName] = useState(payee.name)
  const [mergeTarget, setMergeTarget] = useState<number | undefined>(undefined)
  const [aliasTarget, setAliasTarget] = useState<Record<string, number | undefined>>({})
  const [confirm, setConfirm] = useState<'merge' | 'delete' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const mergeRef = useRef<HTMLButtonElement | null>(null)
  const deleteRef = useRef<HTMLButtonElement | null>(null)
  const item = `${URL}/${payee.id}`
  const others = payees.filter((p) => p.id !== payee.id)
  const inUse = payee.transactionCount > 0 || payee.rules > 0 || payee.scheduled > 0
  const targetName = payees.find((p) => p.id === mergeTarget)?.name ?? ''

  function run(action: () => Promise<void>, after: () => void = onChanged) {
    setBusy(true)
    setError(null)
    return action()
      .then(after)
      .catch((caught: unknown) => setError(adminErrorMessage(caught)))
      .finally(() => setBusy(false))
  }

  return (
    <aside className={styles.panel} aria-label={`收款人 ${payee.name}`}>
      <header className={styles.panelHeader}>
        <h2 className={styles.sectionTitle}>{payee.name}</h2>
        <button type="button" className={styles.close} aria-label="關閉" onClick={onClose}>
          ×
        </button>
      </header>
      <p className={styles.muted}>
        {payee.transactionCount} 筆交易
        {payee.rules > 0 && ` · ${payee.rules} 條規則`}
        {payee.scheduled > 0 && ` · ${payee.scheduled} 個週期項目`}
      </p>

      <form
        className={styles.field}
        onSubmit={(event) => {
          event.preventDefault()
          if (name.trim() && name !== payee.name) void run(() => sendNoContent('PATCH', item, { name }))
        }}
      >
        <label className={styles.label} htmlFor="payee-name">
          名稱
        </label>
        <div className={styles.row}>
          <input
            id="payee-name"
            className={styles.input}
            maxLength={NAME_MAX_LENGTH}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <button type="submit" className={styles.button} disabled={busy || !name.trim() || name === payee.name}>
            改名
          </button>
        </div>
      </form>

      <div className={styles.field}>
        <span className={styles.label}>別名(匯入時這些寫法會對到這個收款人)</span>
        {payee.aliases.length === 0 && <span className={styles.muted}>沒有別名(手動輸入的收款人)。</span>}
        {payee.aliases.map((alias) => (
          <div key={alias} className={styles.field}>
            <span>{alias}</span>
            <div className={styles.row}>
              <PayeePicker
                payees={others}
                value={aliasTarget[alias]}
                placeholder="移到…"
                onChange={(id) => setAliasTarget({ ...aliasTarget, [alias]: id })}
              />
              <button
                type="button"
                className={styles.button}
                disabled={busy || aliasTarget[alias] === undefined}
                onClick={() => void run(() => sendNoContent('PATCH', `${URL}/aliases`, { alias, payeeId: aliasTarget[alias] }))}
              >
                移過去
              </button>
              <button
                type="button"
                className={styles.button}
                disabled={busy}
                onClick={() => void run(() => sendNoContent('DELETE', `${URL}/aliases`, { alias }))}
              >
                刪除
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className={styles.field}>
        <span className={styles.label}>合併到</span>
        <span className={styles.muted}>交易、別名、規則、週期項目都改指向選的收款人,這個收款人會被刪掉。</span>
        <div className={styles.row}>
          <PayeePicker payees={others} value={mergeTarget} placeholder="選一個收款人" onChange={setMergeTarget} />
          <button
            ref={mergeRef}
            type="button"
            className={styles.button}
            disabled={busy || mergeTarget === undefined}
            onClick={() => setConfirm('merge')}
          >
            合併
          </button>
        </div>
      </div>

      <div className={styles.footer}>
        <button
          ref={deleteRef}
          type="button"
          className={styles.delete}
          disabled={busy || inUse}
          onClick={() => setConfirm('delete')}
        >
          刪除收款人
        </button>
        {inUse && <span className={styles.muted}>有交易、規則或週期項目用到時不能刪,可以合併到別的收款人。</span>}
      </div>

      {error && <p className={styles.error}>{error}</p>}

      <ConfirmDialog
        open={confirm === 'merge'}
        title={`把「${payee.name}」合併到「${targetName}」?`}
        description={`${payee.transactionCount} 筆交易與 ${payee.aliases.length} 個別名會改到「${targetName}」,「${payee.name}」會被刪掉。無法復原。`}
        confirmLabel="合併"
        onConfirm={() =>
          run(() => sendNoContent('POST', `${item}/merge`, { targetId: mergeTarget }), onRemoved).then(() => setConfirm(null))
        }
        onCancel={() => setConfirm(null)}
        triggerRef={mergeRef}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        title={`刪除「${payee.name}」?`}
        description="這個收款人沒有被任何交易、規則或週期項目用到;它的別名會一起刪掉。"
        confirmLabel="刪除"
        onConfirm={() => run(() => sendNoContent('DELETE', item), onRemoved).then(() => setConfirm(null))}
        onCancel={() => setConfirm(null)}
        triggerRef={deleteRef}
      />
    </aside>
  )
}
