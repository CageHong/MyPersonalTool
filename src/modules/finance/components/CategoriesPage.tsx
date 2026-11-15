'use client'

import { useEffect, useRef, useState } from 'react'
import { adminErrorMessage, getJson, loadErrorMessage, postJson, sendNoContent } from '../lib/api'
import type { CategoryNode } from '../lib/categories'
import { NAME_MAX_LENGTH } from '../lib/edit'
import ConfirmDialog from './ConfirmDialog'
import styles from './AdminPage.module.css'

// 分類管理:支出、收入兩區,各自是兩層的清單;點一個分類在右欄改名、換上層、排序、封存、合併、刪除。
// 規則(伺服器檢查):系統分類不能動、有交易只能封存或合併、類型不能改、只有兩層

const URL = '/api/finance/categories'
type CategoryType = 'expense' | 'income'
const TYPE_LABELS: Record<CategoryType, string> = { expense: '支出', income: '收入' }

export default function CategoriesPage() {
  const [categories, setCategories] = useState<CategoryNode[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [selectedId, setSelectedId] = useState<number | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    getJson<{ categories: CategoryNode[] }>(URL, controller.signal)
      .then((result) => {
        setCategories(result.categories)
        setLoadError(null)
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setLoadError(loadErrorMessage(caught))
      })
    return () => controller.abort()
  }, [attempt])

  const reload = () => setAttempt((n) => n + 1)
  const selected = categories?.find((c) => c.id === selectedId) ?? null

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.heading}>分類</h1>
      </header>
      {loadError && (
        <p className={styles.error}>
          {loadError}{' '}
          <button type="button" className={styles.button} onClick={reload}>
            重試
          </button>
        </p>
      )}
      {!categories && !loadError && <p className={styles.muted}>載入中…</p>}
      {categories && (
        <div className={styles.body}>
          <div className={styles.columns}>
            {(['expense', 'income'] as const).map((type) => (
              <section key={type} className={styles.section} aria-label={`${TYPE_LABELS[type]}分類`}>
                <h2 className={styles.sectionTitle}>{TYPE_LABELS[type]}</h2>
                <NewCategory type={type} categories={categories} onCreated={reload} />
                <ul className={styles.list}>
                  {categories
                    .filter((c) => c.type === type)
                    .map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          className={[
                            styles.item,
                            c.parentId !== null && styles.child,
                            c.id === selectedId && styles.selected,
                            !c.isActive && styles.archived,
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          aria-current={c.id === selectedId ? 'true' : undefined}
                          onClick={() => setSelectedId(c.id === selectedId ? null : c.id)}
                        >
                          <span>
                            {c.name}
                            {!c.isActive && '(封存)'}
                            {c.isSystem && <span className={styles.badge}>系統</span>}
                          </span>
                          <span className={styles.count}>{c.transactions}</span>
                        </button>
                      </li>
                    ))}
                </ul>
              </section>
            ))}
          </div>
          {selected && (
            <CategoryPanel
              key={selected.id}
              category={selected}
              categories={categories}
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

// 可以當上層的:同類型的最上層、不是系統分類、不是自己
function parentOptions(categories: CategoryNode[], type: CategoryType, selfId?: number) {
  return categories.filter((c) => c.type === type && c.parentId === null && !c.isSystem && c.id !== selfId)
}

function NewCategory({ type, categories, onCreated }: { type: CategoryType; categories: CategoryNode[]; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [parentId, setParentId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <form
      className={styles.inlineForm}
      onSubmit={(event) => {
        event.preventDefault()
        if (!name.trim() || saving) return
        setSaving(true)
        setError(null)
        postJson(URL, { name, type, parentId })
          .then(() => {
            setName('')
            onCreated()
          })
          .catch((caught: unknown) => setError(adminErrorMessage(caught)))
          .finally(() => setSaving(false))
      }}
    >
      <input
        className={styles.input}
        placeholder={`新增${TYPE_LABELS[type]}分類`}
        aria-label={`新增${TYPE_LABELS[type]}分類的名稱`}
        maxLength={NAME_MAX_LENGTH}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <select
        className={styles.input}
        aria-label="上層"
        value={parentId ?? ''}
        onChange={(event) => setParentId(event.target.value === '' ? null : Number(event.target.value))}
      >
        <option value="">(最上層)</option>
        {parentOptions(categories, type).map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <button type="submit" className={styles.button} disabled={!name.trim() || saving}>
        新增
      </button>
      {error && <span className={styles.error}>{error}</span>}
    </form>
  )
}

type PanelProps = {
  category: CategoryNode
  categories: CategoryNode[]
  onChanged: () => void
  onRemoved: () => void
  onClose: () => void
}

function CategoryPanel({ category, categories, onChanged, onRemoved, onClose }: PanelProps) {
  const [name, setName] = useState(category.name)
  const [mergeTarget, setMergeTarget] = useState<number | null>(null)
  const [confirm, setConfirm] = useState<'merge' | 'delete' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const mergeRef = useRef<HTMLButtonElement | null>(null)
  const deleteRef = useRef<HTMLButtonElement | null>(null)
  const item = `${URL}/${category.id}`
  const hasChildren = categories.some((c) => c.parentId === category.id)
  const siblings = categories.filter((c) => c.type === category.type && c.parentId === category.parentId)
  const index = siblings.findIndex((c) => c.id === category.id)
  const mergeTargets = categories.filter((c) => c.type === category.type && c.id !== category.id)
  const inUse = category.transactions > 0 || category.rules > 0 || category.scheduled > 0

  function run(action: () => Promise<void>, after: () => void = onChanged) {
    setBusy(true)
    setError(null)
    return action()
      .then(after)
      .catch((caught: unknown) => setError(adminErrorMessage(caught)))
      .finally(() => setBusy(false))
  }

  const usage = [
    `${category.transactions} 筆交易`,
    category.rules ? `${category.rules} 條規則` : null,
    category.scheduled ? `${category.scheduled} 個週期項目` : null,
  ]
    .filter(Boolean)
    .join('、')

  return (
    <aside className={styles.panel} aria-label={`分類 ${category.name}`}>
      <header className={styles.panelHeader}>
        <h2 className={styles.sectionTitle}>{category.name}</h2>
        <button type="button" className={styles.close} aria-label="關閉" onClick={onClose}>
          ×
        </button>
      </header>
      <p className={styles.muted}>
        {TYPE_LABELS[category.type]}分類 · {usage}
      </p>

      {category.isSystem ? (
        <p className={styles.muted}>系統分類不能改名、移動、封存、合併或刪除。</p>
      ) : (
        <>
          <form
            className={styles.field}
            onSubmit={(event) => {
              event.preventDefault()
              if (name.trim() && name !== category.name) void run(() => sendNoContent('PATCH', item, { name }))
            }}
          >
            <label className={styles.label} htmlFor="category-name">
              名稱
            </label>
            <div className={styles.row}>
              <input
                id="category-name"
                className={styles.input}
                maxLength={NAME_MAX_LENGTH}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              <button type="submit" className={styles.button} disabled={busy || !name.trim() || name === category.name}>
                改名
              </button>
            </div>
          </form>

          <label className={styles.field}>
            <span className={styles.label}>上層</span>
            <select
              className={styles.input}
              value={category.parentId ?? ''}
              disabled={busy || (hasChildren && category.parentId === null)}
              onChange={(event) => {
                const parentId = event.target.value === '' ? null : Number(event.target.value)
                void run(() => sendNoContent('PATCH', item, { parentId }))
              }}
            >
              <option value="">(最上層)</option>
              {parentOptions(categories, category.type, category.id).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {hasChildren && category.parentId === null && <span className={styles.muted}>底下有子分類,不能放到別人底下。</span>}
          </label>

          <div className={styles.field}>
            <span className={styles.label}>順序(同一層)</span>
            <div className={styles.row}>
              <button
                type="button"
                className={styles.button}
                disabled={busy || index <= 0}
                onClick={() => void run(() => sendNoContent('POST', `${item}/move`, { direction: 'up' }))}
              >
                上移
              </button>
              <button
                type="button"
                className={styles.button}
                disabled={busy || index >= siblings.length - 1}
                onClick={() => void run(() => sendNoContent('POST', `${item}/move`, { direction: 'down' }))}
              >
                下移
              </button>
            </div>
          </div>

          <div className={styles.field}>
            <span className={styles.label}>封存</span>
            <span className={styles.muted}>封存後新交易選不到,舊資料保留。</span>
            <div className={styles.row}>
              <button
                type="button"
                className={styles.button}
                disabled={busy}
                onClick={() => void run(() => sendNoContent('PATCH', item, { isActive: !category.isActive }))}
              >
                {category.isActive ? '封存' : '取消封存'}
              </button>
            </div>
          </div>

          <div className={styles.field}>
            <span className={styles.label}>合併到</span>
            <span className={styles.muted}>交易、規則、週期項目都改指向選的分類,這個分類會被刪掉。</span>
            <div className={styles.row}>
              <select
                className={styles.input}
                aria-label="合併到哪個分類"
                value={mergeTarget ?? ''}
                disabled={hasChildren}
                onChange={(event) => setMergeTarget(event.target.value === '' ? null : Number(event.target.value))}
              >
                <option value="">(選一個分類)</option>
                {mergeTargets.map((c) => {
                  const parent = c.parentId !== null ? categories.find((p) => p.id === c.parentId)?.name : null
                  return (
                    <option key={c.id} value={c.id}>
                      {parent ? `${parent} / ${c.name}` : c.name}
                    </option>
                  )
                })}
              </select>
              <button
                ref={mergeRef}
                type="button"
                className={styles.button}
                disabled={busy || mergeTarget === null || hasChildren}
                onClick={() => setConfirm('merge')}
              >
                合併
              </button>
            </div>
            {hasChildren && <span className={styles.muted}>底下有子分類,先把子分類移走或合併。</span>}
          </div>

          <div className={styles.footer}>
            <button
              ref={deleteRef}
              type="button"
              className={styles.delete}
              disabled={busy || inUse || hasChildren}
              onClick={() => setConfirm('delete')}
            >
              刪除分類
            </button>
            {(inUse || hasChildren) && <span className={styles.muted}>有交易、規則、週期項目或子分類時不能刪,可以封存或合併。</span>}
          </div>
        </>
      )}

      {error && <p className={styles.error}>{error}</p>}

      <ConfirmDialog
        open={confirm === 'merge'}
        title={`合併「${category.name}」?`}
        description={`${usage}會改到「${mergeTargets.find((c) => c.id === mergeTarget)?.name ?? ''}」,「${category.name}」會被刪掉。無法復原。`}
        confirmLabel="合併"
        onConfirm={() =>
          run(
            () => sendNoContent('POST', `${item}/merge`, { targetId: mergeTarget }),
            onRemoved,
          ).then(() => setConfirm(null))
        }
        onCancel={() => setConfirm(null)}
        triggerRef={mergeRef}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        title={`刪除「${category.name}」?`}
        description="這個分類沒有被任何交易、規則或週期項目用到。"
        confirmLabel="刪除"
        onConfirm={() => run(() => sendNoContent('DELETE', item), onRemoved).then(() => setConfirm(null))}
        onCancel={() => setConfirm(null)}
        triggerRef={deleteRef}
      />
    </aside>
  )
}
