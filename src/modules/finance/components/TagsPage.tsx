'use client'

import { useEffect, useRef, useState } from 'react'
import { adminErrorMessage, getJson, loadErrorMessage, postJson, sendNoContent } from '../lib/api'
import { formatLocalDate } from '../lib/date'
import { NAME_MAX_LENGTH } from '../lib/edit'
import type { TagRangeItem, TagRow } from '../lib/tags'
import ConfirmDialog from './ConfirmDialog'
import styles from './AdminPage.module.css'

// 標籤管理:清單 → 右欄改名、旅行的日期範圍、「把範圍內的交易加上這個標籤」(先預覽、可以逐筆取消)、合併、刪除

const URL = '/api/finance/tags'

export default function TagsPage() {
  const [tags, setTags] = useState<TagRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [newName, setNewName] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    getJson<{ tags: TagRow[] }>(URL, controller.signal)
      .then((result) => {
        setTags(result.tags)
        setLoadError(null)
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setLoadError(loadErrorMessage(caught))
      })
    return () => controller.abort()
  }, [attempt])

  const reload = () => setAttempt((n) => n + 1)
  const selected = tags?.find((t) => t.id === selectedId) ?? null

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.heading}>標籤</h1>
      </header>
      {loadError && (
        <p className={styles.error}>
          {loadError}{' '}
          <button type="button" className={styles.button} onClick={reload}>
            重試
          </button>
        </p>
      )}
      {!tags && !loadError && <p className={styles.muted}>載入中…</p>}
      {tags && (
        <div className={styles.body}>
          <section className={styles.section} aria-label="標籤清單">
            <form
              className={styles.inlineForm}
              onSubmit={(event) => {
                event.preventDefault()
                if (!newName.trim()) return
                setCreateError(null)
                postJson(URL, { name: newName })
                  .then(() => {
                    setNewName('')
                    reload()
                  })
                  .catch((caught: unknown) => setCreateError(adminErrorMessage(caught)))
              }}
            >
              <input
                className={styles.input}
                placeholder="新增標籤"
                aria-label="新增標籤的名稱"
                maxLength={NAME_MAX_LENGTH}
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
              />
              <button type="submit" className={styles.button} disabled={!newName.trim()}>
                新增
              </button>
              {createError && <span className={styles.error}>{createError}</span>}
            </form>
            <ul className={styles.list}>
              {tags.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    className={t.id === selectedId ? `${styles.item} ${styles.selected}` : styles.item}
                    aria-current={t.id === selectedId ? 'true' : undefined}
                    onClick={() => setSelectedId(t.id === selectedId ? null : t.id)}
                  >
                    <span>
                      {t.name}
                      {t.startsOn && (
                        <span className={styles.badge}>
                          {t.startsOn} ~ {t.endsOn}
                        </span>
                      )}
                    </span>
                    <span className={styles.count}>{t.transactions}</span>
                  </button>
                </li>
              ))}
              {tags.length === 0 && <li className={styles.muted}>還沒有標籤</li>}
            </ul>
          </section>
          {selected && (
            <TagPanel
              key={`${selected.id}:${selected.startsOn}:${selected.endsOn}`}
              tag={selected}
              tags={tags}
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
  tag: TagRow
  tags: TagRow[]
  onChanged: () => void
  onRemoved: () => void
  onClose: () => void
}

function TagPanel({ tag, tags, onChanged, onRemoved, onClose }: PanelProps) {
  const [name, setName] = useState(tag.name)
  const [startsOn, setStartsOn] = useState(tag.startsOn ?? '')
  const [endsOn, setEndsOn] = useState(tag.endsOn ?? '')
  const [mergeTarget, setMergeTarget] = useState<number | ''>('')
  const [range, setRange] = useState<TagRangeItem[] | null>(null)
  const [chosen, setChosen] = useState<Set<number>>(new Set())
  const [confirm, setConfirm] = useState<'merge' | 'delete' | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const mergeRef = useRef<HTMLButtonElement | null>(null)
  const deleteRef = useRef<HTMLButtonElement | null>(null)
  const item = `${URL}/${tag.id}`
  const rangeChanged = startsOn !== (tag.startsOn ?? '') || endsOn !== (tag.endsOn ?? '')
  const targetName = tags.find((t) => t.id === mergeTarget)?.name ?? ''

  function run(action: () => Promise<unknown>, after: () => void = onChanged) {
    setBusy(true)
    setError(null)
    setMessage(null)
    return action()
      .then(after)
      .catch((caught: unknown) => setError(adminErrorMessage(caught)))
      .finally(() => setBusy(false))
  }

  function loadRange() {
    void run(
      () =>
        getJson<{ items: TagRangeItem[] }>(`${item}/range`).then((result) => {
          setRange(result.items)
          setChosen(new Set(result.items.map((i) => i.transactionId)))
        }),
      () => undefined,
    )
  }

  return (
    <aside className={styles.panel} aria-label={`標籤 ${tag.name}`}>
      <header className={styles.panelHeader}>
        <h2 className={styles.sectionTitle}>{tag.name}</h2>
        <button type="button" className={styles.close} aria-label="關閉" onClick={onClose}>
          ×
        </button>
      </header>
      <p className={styles.muted}>{tag.transactions} 筆交易</p>

      <form
        className={styles.field}
        onSubmit={(event) => {
          event.preventDefault()
          if (name.trim() && name !== tag.name) void run(() => sendNoContent('PATCH', item, { name }))
        }}
      >
        <label className={styles.label} htmlFor="tag-name">
          名稱
        </label>
        <div className={styles.row}>
          <input
            id="tag-name"
            className={styles.input}
            maxLength={NAME_MAX_LENGTH}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <button type="submit" className={styles.button} disabled={busy || !name.trim() || name === tag.name}>
            改名
          </button>
        </div>
      </form>

      <form
        className={styles.field}
        onSubmit={(event) => {
          event.preventDefault()
          void run(() => sendNoContent('PATCH', item, { startsOn: startsOn || null, endsOn: endsOn || null }))
        }}
      >
        <span className={styles.label}>旅行的日期(第一天、最後一天;一般標籤留空)</span>
        <div className={styles.row}>
          <input
            className={styles.input}
            type="date"
            aria-label="第一天"
            value={startsOn}
            onChange={(event) => setStartsOn(event.target.value)}
          />
          <input
            className={styles.input}
            type="date"
            aria-label="最後一天"
            value={endsOn}
            onChange={(event) => setEndsOn(event.target.value)}
          />
        </div>
        <div className={styles.row}>
          <button type="submit" className={styles.button} disabled={busy || !rangeChanged}>
            儲存日期
          </button>
          {(startsOn || endsOn) && (
            <button
              type="button"
              className={styles.button}
              onClick={() => {
                setStartsOn('')
                setEndsOn('')
              }}
            >
              清空
            </button>
          )}
        </div>
      </form>

      {tag.startsOn && tag.endsOn && (
        <div className={styles.field}>
          <span className={styles.label}>把範圍內的交易加上這個標籤</span>
          <span className={styles.muted}>只列範圍內還沒有這個標籤的交易(日期以 UTC 切日)。</span>
          <div className={styles.row}>
            <button type="button" className={styles.button} disabled={busy} onClick={loadRange}>
              {range ? '重新預覽' : '預覽'}
            </button>
            {range && range.length > 0 && (
              <button
                type="button"
                className={styles.primary}
                disabled={busy || chosen.size === 0}
                onClick={() =>
                  void run(
                    () =>
                      postJson<{ applied: number }>(`${item}/range`, { transactionIds: [...chosen] }).then((result) => {
                        setMessage(`已加上 ${result.applied} 筆。`)
                        setRange(null)
                      }),
                  )
                }
              >
                加上選中的 {chosen.size} 筆
              </button>
            )}
          </div>
          {range && range.length === 0 && <span className={styles.muted}>範圍內的交易都已經有這個標籤。</span>}
          {range && range.length > 0 && (
            <ul className={styles.list}>
              {range.map((r) => (
                <li key={r.transactionId}>
                  <label className={styles.item}>
                    <span>
                      <input
                        type="checkbox"
                        checked={chosen.has(r.transactionId)}
                        onChange={(event) => {
                          const next = new Set(chosen)
                          if (event.target.checked) next.add(r.transactionId)
                          else next.delete(r.transactionId)
                          setChosen(next)
                        }}
                      />{' '}
                      {formatLocalDate(r.occurredAt)} {r.payee ?? '—'}
                    </span>
                    <span className={styles.muted}>{r.kind ?? '轉帳'}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className={styles.field}>
        <span className={styles.label}>合併到</span>
        <span className={styles.muted}>這個標籤的交易都加上選的標籤,這個標籤會被刪掉。</span>
        <div className={styles.row}>
          <select
            className={styles.input}
            aria-label="合併到哪個標籤"
            value={mergeTarget}
            onChange={(event) => setMergeTarget(event.target.value === '' ? '' : Number(event.target.value))}
          >
            <option value="">(選一個標籤)</option>
            {tags
              .filter((t) => t.id !== tag.id)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </select>
          <button
            ref={mergeRef}
            type="button"
            className={styles.button}
            disabled={busy || mergeTarget === ''}
            onClick={() => setConfirm('merge')}
          >
            合併
          </button>
        </div>
      </div>

      <div className={styles.footer}>
        <button ref={deleteRef} type="button" className={styles.delete} disabled={busy} onClick={() => setConfirm('delete')}>
          刪除標籤
        </button>
      </div>

      {message && <p className={styles.muted}>{message}</p>}
      {error && <p className={styles.error}>{error}</p>}

      <ConfirmDialog
        open={confirm === 'merge'}
        title={`把「${tag.name}」合併到「${targetName}」?`}
        description={`${tag.transactions} 筆交易會加上「${targetName}」,「${tag.name}」會被刪掉。無法復原。`}
        confirmLabel="合併"
        onConfirm={() =>
          run(() => sendNoContent('POST', `${item}/merge`, { targetId: mergeTarget }), onRemoved).then(() => setConfirm(null))
        }
        onCancel={() => setConfirm(null)}
        triggerRef={mergeRef}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        title={`刪除「${tag.name}」?`}
        description={`${tag.transactions} 筆交易上的這個標籤會一起拿掉,交易本身不受影響。`}
        confirmLabel="刪除"
        onConfirm={() => run(() => sendNoContent('DELETE', item), onRemoved).then(() => setConfirm(null))}
        onCancel={() => setConfirm(null)}
        triggerRef={deleteRef}
      />
    </aside>
  )
}
