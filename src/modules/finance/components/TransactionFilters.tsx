'use client'

import { useEffect, useRef, useState } from 'react'
import { RANGE_PRESETS, localToday, matchPreset, presetRange } from '../lib/date'
import type { RangePreset } from '../lib/date'
import { KIND_LABELS, SEARCH_MAX_LENGTH, TRANSACTION_KINDS } from '../lib/transactions'
import type { FinanceLookups, TransactionFilter, TransactionKind } from '../lib/transactions'
import PayeePicker from './PayeePicker'
import styles from './TransactionFilters.module.css'

// 交易清單的篩選列。只負責把使用者的選擇變成新的篩選條件交給上層;條件存在網址裡,
// 這個元件只存搜尋框正在打的字,以及期間快捷用的今天

const SEARCH_DELAY_MS = 300

type Props = {
  filter: TransactionFilter
  lookups: FinanceLookups | null
  onChange: (next: TransactionFilter, mode?: 'push' | 'replace') => void
  onClear: () => void
  canClear: boolean
}

// select 的值 → 數字 id;空字串 = 沒有選
function idOf(value: string): number | undefined {
  return value === '' ? undefined : Number(value)
}

export default function TransactionFilters({ filter, lookups, onChange, onClear, canClear }: Props) {
  // 搜尋框:打字先存在這裡,停下來一段時間才寫進網址。
  // 網址的 q 從外面變了(上一頁、清除篩選)就跟著換掉
  const [text, setText] = useState(filter.q ?? '')
  const [syncedQ, setSyncedQ] = useState(filter.q)
  if (filter.q !== syncedQ) {
    setSyncedQ(filter.q)
    setText(filter.q ?? '')
  }

  const latest = useRef({ filter, onChange })
  useEffect(() => {
    latest.current = { filter, onChange }
  })

  useEffect(() => {
    const trimmed = text.trim()
    if (trimmed === (latest.current.filter.q ?? '')) return
    const timer = setTimeout(() => {
      latest.current.onChange({ ...latest.current.filter, q: trimmed || undefined }, 'replace')
    }, SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [text])

  const set = (patch: Partial<TransactionFilter>) => onChange({ ...filter, ...patch })

  // 期間快捷用的「今天」:開頁時算一次就好(快捷是月、年為單位,跨日不影響)
  const [today] = useState(() => localToday())
  const preset = matchPreset(filter.from, filter.to, today)
  function choosePreset(value: string) {
    if (value === 'all') set({ from: undefined, to: undefined })
    else if (value !== 'custom') set(presetRange(value as RangePreset, today))
  }

  const accounts = lookups?.accounts.filter((a) => a.type === 'asset' || a.type === 'liability') ?? []
  const categoryGroups = (['expense', 'income'] as const).map((type) => {
    const ofType = lookups?.accounts.filter((a) => a.type === type) ?? []
    const tops = ofType.filter((a) => a.parentId === null)
    return {
      type,
      label: type === 'expense' ? '支出' : '收入',
      // 上層後面接它的子分類
      options: tops.flatMap((top) => [
        { id: top.id, label: top.name },
        ...ofType.filter((a) => a.parentId === top.id).map((child) => ({ id: child.id, label: `　${child.name}` })),
      ]),
    }
  })

  return (
    <div className={styles.filters}>
      <input
        className={styles.search}
        type="search"
        placeholder="搜尋對象、備註"
        aria-label="搜尋對象、備註"
        maxLength={SEARCH_MAX_LENGTH}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />

      <div className={styles.range}>
        <select
          className={styles.field}
          aria-label="期間"
          value={preset}
          onChange={(event) => choosePreset(event.target.value)}
        >
          <option value="all">全部期間</option>
          {RANGE_PRESETS.map(({ key, label }) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
          {preset === 'custom' && <option value="custom">自訂</option>}
        </select>
        <DateField label="開始日期" value={filter.from} max={filter.to} onChange={(from) => set({ from })} />
        <span className={styles.muted}>–</span>
        <DateField label="結束日期" value={filter.to} min={filter.from} onChange={(to) => set({ to })} />
      </div>

      <select
        className={styles.field}
        aria-label="帳戶"
        value={filter.accountId ?? ''}
        onChange={(event) => set({ accountId: idOf(event.target.value) })}
      >
        <option value="">所有帳戶</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
            {a.isActive ? '' : '(已封存)'}
          </option>
        ))}
      </select>

      <select
        className={styles.field}
        aria-label="分類"
        value={filter.categoryId ?? ''}
        onChange={(event) => set({ categoryId: idOf(event.target.value) })}
      >
        <option value="">所有分類</option>
        {categoryGroups.map((group) => (
          <optgroup key={group.type} label={group.label}>
            {group.options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      <select
        className={styles.field}
        aria-label="標籤"
        value={filter.tagId ?? ''}
        onChange={(event) => set({ tagId: idOf(event.target.value) })}
      >
        <option value="">所有標籤</option>
        {lookups?.tags.map((tag) => (
          <option key={tag.id} value={tag.id}>
            {tag.name}
          </option>
        ))}
      </select>

      <PayeePicker payees={lookups?.payees ?? null} value={filter.payeeId} onChange={(payeeId) => set({ payeeId })} />

      <select
        className={styles.field}
        aria-label="類型"
        value={filter.kind ?? ''}
        onChange={(event) => set({ kind: (event.target.value || undefined) as TransactionKind | undefined })}
      >
        <option value="">所有類型</option>
        {TRANSACTION_KINDS.map((kind) => (
          <option key={kind} value={kind}>
            {KIND_LABELS[kind]}
          </option>
        ))}
      </select>

      <label className={styles.check}>
        <input
          type="checkbox"
          checked={filter.uncategorized ?? false}
          onChange={(event) => set({ uncategorized: event.target.checked || undefined })}
        />
        只看未分類
      </label>

      <select
        className={styles.field}
        aria-label="排序"
        value={filter.order}
        onChange={(event) => set({ order: event.target.value === 'asc' ? 'asc' : 'desc' })}
      >
        <option value="desc">由新到舊</option>
        <option value="asc">由舊到新</option>
      </select>

      <button type="button" className={styles.clear} onClick={onClear} disabled={!canClear}>
        清除篩選
      </button>
    </div>
  )
}

// 原生的日期欄位,旁邊有單獨清除這一格的按鈕(原生欄位在有些瀏覽器清不掉)
function DateField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  value: string | undefined
  min?: string
  max?: string
  onChange: (value: string | undefined) => void
}) {
  return (
    <span className={styles.dateField}>
      <input
        className={styles.field}
        type="date"
        aria-label={label}
        value={value ?? ''}
        min={min}
        max={max}
        onChange={(event) => onChange(event.target.value || undefined)}
      />
      {value && (
        <button type="button" className={styles.dateClear} aria-label={`清除${label}`} onClick={() => onChange(undefined)}>
          ×
        </button>
      )}
    </span>
  )
}
