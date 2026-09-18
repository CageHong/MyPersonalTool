import { useEffect, useId, useRef, useState } from 'react'
import { formatShortDate, todayIso } from '@/lib/date'
import {
  describeRule,
  FREQS,
  upcomingOccurrences,
  weekdayBit,
  type Freq,
  type RecurrenceSpec,
} from '@/lib/recurrence'
import styles from './RecurrenceDialog.module.css'

// null = 沒有送出就關掉(取消、Esc、點背景)
export type RecurrenceResult = { spec: RecurrenceSpec } | null

type Props = {
  // 錨點 = 任務的截止日,沒有就是今天;選單內不提供日期欄位
  anchor: string
  // 唯一的關閉通知,只從 <dialog> 的 close 事件發出;焦點由呼叫端移回觸發鈕
  onClose: (result: RecurrenceResult) => void
}

const FREQ_LABELS: Record<Freq, { label: string; unit: string }> = {
  daily: { label: '每天', unit: '天' },
  weekly: { label: '每週', unit: '週' },
  monthly: { label: '每月', unit: '個月' },
  yearly: { label: '每年', unit: '年' },
}

// bit 0..6 = 一 → 日,和 weekdays bitmask 同一個順序
const WEEKDAY_TOGGLES = ['一', '二', '三', '四', '五', '六', '日']

const PREVIEW_COUNT = 4

type Draft = {
  freq: Freq
  // 輸入框的原始字串:使用者可以先刪空再打,送出前才驗證
  intervalText: string
  // 一直保留;只有每週時才送出
  weekdays: number
}

type DraftErrors = { interval?: string; weekdays?: string }

function parseInterval(text: string): number | null {
  if (!/^\d+$/.test(text.trim())) {
    return null
  }
  const value = Number(text)
  return value >= 1 && value <= 99 ? value : null
}

// 草稿 → 規格;不合法時回傳錯誤,不回傳規格
function toSpec(draft: Draft, anchor: string): { spec: RecurrenceSpec } | { errors: DraftErrors } {
  const errors: DraftErrors = {}
  const interval = parseInterval(draft.intervalText)
  if (interval === null) {
    errors.interval = '間隔要是 1 到 99 的整數'
  }
  if (draft.freq === 'weekly' && draft.weekdays === 0) {
    errors.weekdays = '至少選一天'
  }
  if (interval === null || Object.keys(errors).length > 0) {
    return { errors }
  }
  return {
    spec: {
      freq: draft.freq,
      interval,
      weekdays: draft.freq === 'weekly' ? draft.weekdays : null,
      startDate: anchor,
    },
  }
}

export default function RecurrenceDialog({ anchor, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  // 確定先記下結果再 close();close 事件讀它。呼叫端只在開啟時掛載,每次開啟都從 null 開始
  const resultRef = useRef<RecurrenceResult>(null)
  // 呼叫端開啟時才掛載,預設值每次開啟都重算:每週預設勾錨點那天
  const [draft, setDraft] = useState<Draft>({
    freq: 'daily',
    intervalText: '1',
    weekdays: weekdayBit(anchor),
  })
  // 按確定時才驗證;不停用確定鈕(docs/decisions.md §5),不合法就留在選單裡顯示訊息
  const [errors, setErrors] = useState<DraftErrors>({})
  const idPrefix = useId()

  // 同 DueDateDialog:showModal() 取得 Esc、焦點鎖定與背景 inert;焦點明確放在 dialog 本身
  useEffect(() => {
    const dialog = ref.current
    if (dialog === null) {
      return
    }
    if (!dialog.open) {
      dialog.showModal()
    }
    dialog.focus()
  }, [])

  // 所有關閉路徑(確定、取消、Esc、點背景)都經 close(),再由 close 事件通知呼叫端
  function closeWith(result: RecurrenceResult) {
    resultRef.current = result
    ref.current?.close()
  }

  function update(patch: Partial<Draft>, clears: keyof DraftErrors) {
    setDraft((current) => ({ ...current, ...patch }))
    // 一修改該欄位就清掉它的錯誤
    setErrors((current) => {
      if (current[clears] === undefined) {
        return current
      }
      const next = { ...current }
      delete next[clears]
      return next
    })
  }

  function confirm() {
    const outcome = toSpec(draft, anchor)
    if ('errors' in outcome) {
      setErrors(outcome.errors)
      return
    }
    closeWith({ spec: outcome.spec })
  }

  const today = todayIso()
  const preview = toSpec(draft, anchor)
  const intervalId = `${idPrefix}-interval`
  const errorId = (field: keyof DraftErrors) => `${idPrefix}-${field}-error`

  return (
    <dialog
      ref={ref}
      tabIndex={-1}
      className={styles.dialog}
      aria-label="重複"
      // Esc 由瀏覽器直接關閉,resultRef 維持 null
      onClose={() => onClose(resultRef.current)}
      // dialog 自己沒有內距,點到它本身就是點到 backdrop
      onClick={(event) => {
        if (event.target === ref.current) {
          closeWith(null)
        }
      }}
    >
      <div className={styles.content}>
        <fieldset className={styles.freqs}>
          <legend className={styles.label}>頻率</legend>
          {FREQS.map((freq) => (
            <label key={freq} className={styles.freq}>
              <input
                type="radio"
                name={`${idPrefix}-freq`}
                value={freq}
                checked={draft.freq === freq}
                onChange={() => update({ freq }, 'weekdays')}
              />
              {FREQ_LABELS[freq].label}
            </label>
          ))}
        </fieldset>

        <div className={styles.row}>
          <label className={styles.label} htmlFor={intervalId}>
            間隔
          </label>
          <div className={styles.interval}>
            每
            <input
              id={intervalId}
              type="number"
              min={1}
              max={99}
              step={1}
              inputMode="numeric"
              className={styles.intervalInput}
              value={draft.intervalText}
              onChange={(event) => update({ intervalText: event.target.value }, 'interval')}
              aria-invalid={errors.interval !== undefined}
              aria-describedby={errors.interval === undefined ? undefined : errorId('interval')}
            />
            {FREQ_LABELS[draft.freq].unit}
          </div>
          {errors.interval !== undefined && (
            <p id={errorId('interval')} className={styles.error} role="alert">
              {errors.interval}
            </p>
          )}
        </div>

        {draft.freq === 'weekly' && (
          <div className={styles.row}>
            <span className={styles.label} id={`${idPrefix}-weekdays-label`}>
              星期
            </span>
            <div
              className={styles.weekdays}
              role="group"
              aria-labelledby={`${idPrefix}-weekdays-label`}
              aria-describedby={errors.weekdays === undefined ? undefined : errorId('weekdays')}
            >
              {WEEKDAY_TOGGLES.map((label, index) => {
                const bit = 1 << index
                const pressed = (draft.weekdays & bit) !== 0
                return (
                  <button
                    key={label}
                    type="button"
                    className={styles.weekday}
                    aria-pressed={pressed}
                    aria-label={`週${label}`}
                    onClick={() => update({ weekdays: draft.weekdays ^ bit }, 'weekdays')}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
            {errors.weekdays !== undefined && (
              <p id={errorId('weekdays')} className={styles.error} role="alert">
                {errors.weekdays}
              </p>
            )}
          </div>
        )}

        {/* 預覽和伺服器實際產生的實例一致:第一個是原任務,之後從今天起(不回溯) */}
        {'spec' in preview && (
          <div className={styles.preview}>
            <ol className={styles.dates}>
              {upcomingOccurrences(preview.spec, today, PREVIEW_COUNT).map((iso) => (
                <li key={iso}>{formatShortDate(iso, today)}</li>
              ))}
            </ol>
            <p className={styles.summary}>{describeRule(preview.spec)}</p>
          </div>
        )}

        <div className={styles.footer}>
          <button type="button" className={styles.cancel} onClick={() => closeWith(null)}>
            取消
          </button>
          <button type="button" className={styles.confirm} onClick={confirm}>
            確定
          </button>
        </div>
      </div>
    </dialog>
  )
}
