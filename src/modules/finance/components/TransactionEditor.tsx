'use client'

import { useEffect, useRef, useState } from 'react'
import { deleteRequest, editErrorMessage, getJson, loadErrorMessage, patchJson } from '../lib/api'
import { fromLocalInputValue, toLocalInputValue } from '../lib/date'
import { NAME_MAX_LENGTH, NOTE_MAX_LENGTH } from '../lib/edit'
import type { TransactionPatch } from '../lib/edit'
import { formatMoney } from '../lib/money'
import { KIND_LABELS } from '../lib/transactions'
import type { FinanceLookups, PostingView, TransactionRow } from '../lib/transactions'
import ConfirmDialog from './ConfirmDialog'
import PayeePicker from './PayeePicker'
import PostingsDialog from './PostingsDialog'
import styles from './TransactionEditor.module.css'

// 單筆編輯的右欄:分類、對象、日期時間、備註、標籤。按「儲存」才送出,只送改過的欄位。
// 打開時重新取這一筆(拿到最新的 updatedAt);伺服器發現資料在打開之後被改過會拒絕。
// 金額與分錄的結構在「編輯分錄…」的對話框改;刪除要先確認

const itemUrl = (id: number) => `/api/finance/transactions/${id}`

type Props = {
  id: number
  lookups: FinanceLookups
  onClose: () => void
  onSaved: (row: TransactionRow) => void
  onDeleted: (id: number) => void
}

export default function TransactionEditor({ id, lookups, onClose, onSaved, onDeleted }: Props) {
  // 取回來的列與錯誤都記住屬於哪個 id,換一筆就自然失效
  const [loaded, setLoaded] = useState<{ id: number; row: TransactionRow } | null>(null)
  const [loadError, setLoadError] = useState<{ id: number; message: string } | null>(null)
  const [savedVersion, setSavedVersion] = useState<string | null>(null)
  const [postingsOpen, setPostingsOpen] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const deleteButtonRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    getJson<TransactionRow>(itemUrl(id), controller.signal)
      .then((row) => setLoaded({ id, row }))
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setLoadError({ id, message: loadErrorMessage(caught) })
      })
    return () => controller.abort()
  }, [id])

  const row = loaded?.id === id ? loaded.row : null
  const error = loadError?.id === id ? loadError.message : null

  function handleSaved(saved: TransactionRow) {
    setLoaded({ id, row: saved })
    setSavedVersion(saved.updatedAt)
    onSaved(saved)
  }

  async function confirmDelete() {
    if (!row) return
    try {
      await deleteRequest(`${itemUrl(row.id)}?expectedUpdatedAt=${encodeURIComponent(row.updatedAt)}`)
      setConfirmingDelete(false)
      onDeleted(row.id)
    } catch (caught) {
      setConfirmingDelete(false)
      setDeleteError(editErrorMessage(caught).replace('沒有儲存', '沒有刪除'))
    }
  }

  return (
    <aside className={styles.panel} aria-label="編輯交易">
      <header className={styles.header}>
        <h2 className={styles.heading}>編輯交易</h2>
        <button type="button" className={styles.close} aria-label="關閉" onClick={onClose}>
          ×
        </button>
      </header>
      {error && <p className={styles.error}>{error}</p>}
      {!row && !error && <p className={styles.muted}>載入中…</p>}
      {row && (
        // 存好之後 updatedAt 變了,表單用新的值重新開始
        <EditorForm
          key={`${row.id}:${row.updatedAt}`}
          row={row}
          lookups={lookups}
          saved={savedVersion === row.updatedAt}
          deleteButtonRef={deleteButtonRef}
          deleteError={deleteError}
          onClose={onClose}
          onSaved={handleSaved}
          onEditPostings={() => setPostingsOpen(true)}
          onDelete={() => {
            setDeleteError(null)
            setConfirmingDelete(true)
          }}
        />
      )}
      {row && postingsOpen && (
        <PostingsDialog row={row} lookups={lookups} onClose={() => setPostingsOpen(false)} onSaved={handleSaved} />
      )}
      <ConfirmDialog
        open={confirmingDelete}
        title="刪除這筆交易?"
        description={
          row?.source === 'manual'
            ? '分錄與標籤會一起刪掉,無法復原。'
            : '分錄與標籤會一起刪掉。這是匯入的交易:之後匯入同一份檔案時不會再加回來。'
        }
        confirmLabel="刪除"
        onConfirm={confirmDelete}
        onCancel={() => setConfirmingDelete(false)}
        triggerRef={deleteButtonRef}
      />
    </aside>
  )
}

type FormProps = {
  row: TransactionRow
  lookups: FinanceLookups
  saved: boolean
  deleteButtonRef: React.RefObject<HTMLButtonElement | null>
  deleteError: string | null
  onClose: () => void
  onSaved: (row: TransactionRow) => void
  onEditPostings: () => void
  onDelete: () => void
}

// 可以換分類的分錄:支出、收入那一側,手續費除外
function editablePostings(row: TransactionRow, lookups: FinanceLookups): PostingView[] {
  return row.postings.filter(
    (p) => (p.accountType === 'expense' || p.accountType === 'income') && p.accountId !== lookups.system.fee,
  )
}

// 分類選單的選項:同類型、不含手續費;封存的只有目前選的那個列出來。上層之後接它的子分類
function categoryOptions(lookups: FinanceLookups, type: 'expense' | 'income', current: number) {
  const usable = lookups.accounts.filter(
    (a) => a.type === type && a.id !== lookups.system.fee && (a.isActive || a.id === current),
  )
  const names = new Map(lookups.accounts.map((a) => [a.id, a.name]))
  const tops = usable.filter((a) => a.parentId === null)
  const children = usable.filter((a) => a.parentId !== null)
  const options = tops.flatMap((top) => [
    { id: top.id, label: top.name },
    ...children.filter((c) => c.parentId === top.id).map((c) => ({ id: c.id, label: `${top.name} / ${c.name}` })),
  ])
  // 上層本身不能選(封存、或不是同類型)的子分類放最後
  for (const child of children) {
    if (!options.some((o) => o.id === child.id)) {
      options.push({ id: child.id, label: `${names.get(child.parentId ?? 0) ?? ''} / ${child.name}` })
    }
  }
  return options
}

function EditorForm({
  row,
  lookups,
  saved,
  deleteButtonRef,
  deleteError,
  onClose,
  onSaved,
  onEditPostings,
  onDelete,
}: FormProps) {
  const editable = editablePostings(row, lookups)
  const initialWhen = toLocalInputValue(row.occurredAt)
  const initialTagIds = row.tags.map((t) => t.id)

  const [when, setWhen] = useState(initialWhen)
  const [payeeId, setPayeeId] = useState<number | null>(row.payee?.id ?? null)
  const [newPayee, setNewPayee] = useState<string | null>(null)
  const [note, setNote] = useState(row.note ?? '')
  const [categories, setCategories] = useState<Record<number, number>>(() =>
    Object.fromEntries(editable.map((p) => [p.id, p.accountId])),
  )
  const [tagIds, setTagIds] = useState<number[]>(initialTagIds)
  const [newTags, setNewTags] = useState<string[]>([])
  const [tagText, setTagText] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 只放改過的欄位;日期時間不合法時是 null
  function buildPatch(): TransactionPatch | null {
    const patch: TransactionPatch = { expectedUpdatedAt: row.updatedAt }
    if (when !== initialWhen) {
      const iso = fromLocalInputValue(when)
      if (!iso) return null
      patch.occurredAt = iso
    }
    if (newPayee !== null) patch.payee = { name: newPayee }
    else if (payeeId !== (row.payee?.id ?? null)) patch.payee = payeeId === null ? null : { id: payeeId }
    if (note.trim() !== (row.note ?? '')) patch.note = note
    const changed = editable.filter((p) => categories[p.id] !== p.accountId)
    if (changed.length) patch.categories = changed.map((p) => ({ postingId: p.id, accountId: categories[p.id] }))
    const sameTags = [...tagIds].sort().join(',') === [...initialTagIds].sort().join(',')
    if (!sameTags || newTags.length) patch.tags = { ids: tagIds, newNames: newTags }
    return patch
  }

  const patch = buildPatch()
  const dirty = patch === null || Object.keys(patch).length > 1

  function save() {
    if (!patch) {
      setError('日期時間不合法。')
      return
    }
    setSaving(true)
    setError(null)
    patchJson<TransactionRow>(itemUrl(row.id), patch)
      .then(onSaved)
      .catch((caught: unknown) => {
        setError(editErrorMessage(caught))
        setSaving(false)
      })
  }

  function addTag() {
    const name = tagText.trim()
    setTagText('')
    if (!name) return
    const existing = lookups.tags.find((t) => t.name === name)
    if (existing) {
      if (!tagIds.includes(existing.id)) setTagIds([...tagIds, existing.id])
    } else if (!newTags.includes(name)) {
      setNewTags([...newTags, name])
    }
  }

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault()
        if (dirty && !saving) save()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented) onClose()
      }}
    >
      <div className={styles.summary}>
        <span className={styles.muted}>{KIND_LABELS[row.kind]}</span>
        {row.legs.map((leg) => (
          <span key={leg.accountId} className={styles.leg}>
            <span>{leg.accountName}</span>
            <span className={styles.amount}>{formatMoney(leg.amount, leg.currency, lookups.exponents)}</span>
          </span>
        ))}
      </div>

      <label className={styles.field}>
        <span className={styles.label}>日期時間</span>
        <input
          className={styles.input}
          type="datetime-local"
          step={1}
          value={when}
          onChange={(event) => setWhen(event.target.value)}
          required
        />
      </label>

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
        {newPayee !== null && <span className={styles.hint}>儲存時新增這個對象</span>}
      </div>

      {editable.length > 0 && (
        <div className={styles.field}>
          <span className={styles.label}>分類</span>
          {editable.map((posting) => (
            <label key={posting.id} className={styles.categoryRow}>
              {editable.length > 1 && (
                <span className={`${styles.amount} ${styles.muted}`}>
                  {formatMoney(posting.amount, posting.currency, lookups.exponents)}
                </span>
              )}
              <select
                className={styles.input}
                aria-label={editable.length > 1 ? `分類(${posting.accountName})` : '分類'}
                value={categories[posting.id]}
                onChange={(event) => setCategories({ ...categories, [posting.id]: Number(event.target.value) })}
              >
                {categoryOptions(lookups, posting.accountType as 'expense' | 'income', posting.accountId).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      )}

      <label className={styles.field}>
        <span className={styles.label}>備註</span>
        <textarea
          className={styles.input}
          rows={3}
          maxLength={NOTE_MAX_LENGTH}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>

      <fieldset className={styles.field}>
        <legend className={styles.label}>標籤</legend>
        <div className={styles.tags}>
          {lookups.tags.map((tag) => (
            <label key={tag.id} className={styles.check}>
              <input
                type="checkbox"
                checked={tagIds.includes(tag.id)}
                onChange={(event) =>
                  setTagIds(event.target.checked ? [...tagIds, tag.id] : tagIds.filter((t) => t !== tag.id))
                }
              />
              {tag.name}
            </label>
          ))}
          {newTags.map((name) => (
            <span key={name} className={styles.newTag}>
              {name}(新)
              <button
                type="button"
                className={styles.removeTag}
                aria-label={`移除新標籤 ${name}`}
                onClick={() => setNewTags(newTags.filter((t) => t !== name))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div className={styles.addTag}>
          <input
            className={styles.input}
            placeholder="新增標籤"
            aria-label="新增標籤的名稱"
            maxLength={NAME_MAX_LENGTH}
            value={tagText}
            onChange={(event) => setTagText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                addTag()
              }
            }}
          />
          <button type="button" className={styles.button} onClick={addTag} disabled={!tagText.trim()}>
            加入
          </button>
        </div>
      </fieldset>

      <div className={styles.actions}>
        <button type="submit" className={styles.primary} disabled={!dirty || saving}>
          {saving ? '儲存中…' : '儲存'}
        </button>
        <span role="status" className={error ? styles.error : styles.muted}>
          {error ?? (saved && !dirty ? '已儲存' : '')}
        </span>
      </div>

      <div className={styles.structure}>
        <span className={styles.label}>分錄</span>
        <span className={styles.hint}>拆帳、改成轉帳、收回保證金或代墊、改金額</span>
        <button type="button" className={styles.button} onClick={onEditPostings} disabled={dirty}>
          編輯分錄…
        </button>
        {dirty && <span className={styles.hint}>先儲存上面的修改,才能編輯分錄</span>}
      </div>

      <div className={styles.footer}>
        <button
          ref={deleteButtonRef}
          type="button"
          className={styles.delete}
          onClick={onDelete}
          disabled={dirty}
        >
          刪除交易
        </button>
        {deleteError && <span className={styles.error}>{deleteError}</span>}
      </div>
    </form>
  )
}
