import { useId, type Ref } from 'react'
import { FREQS, type Freq } from '@/lib/recurrence'
import type { CustomDraft, CustomErrors } from '@/lib/recurrenceDraft'
import styles from './RecurrenceCustomFields.module.css'

type Props = {
  value: CustomDraft
  // 按「完成」時才驗證;不合法時訊息畫在欄位下方,不停用任何按鈕
  errors: CustomErrors
  // clears:這次修改的是哪個欄位,呼叫端據此清掉它的錯誤
  onChange: (patch: Partial<CustomDraft>, clears: keyof CustomErrors) => void
  // 進入自訂畫面時焦點落在頻率的第一個選項
  firstFieldRef?: Ref<HTMLInputElement>
}

const FREQ_LABELS: Record<Freq, { label: string; unit: string }> = {
  daily: { label: '每天', unit: '天' },
  weekly: { label: '每週', unit: '週' },
  monthly: { label: '每月', unit: '個月' },
  yearly: { label: '每年', unit: '年' },
}

// bit 0..6 = 一 → 日,和 weekdays bitmask 同一個順序
const WEEKDAY_TOGGLES = ['一', '二', '三', '四', '五', '六', '日']

// 日期選單「自訂」的欄位:頻率、間隔、星期幾。每月、每年的日子由選單裡的日期決定,不在這裡選
export default function RecurrenceCustomFields({ value, errors, onChange, firstFieldRef }: Props) {
  const idPrefix = useId()
  const intervalId = `${idPrefix}-interval`
  const errorId = (field: keyof CustomErrors) => `${idPrefix}-${field}-error`

  return (
    <div className={styles.fields}>
      <fieldset className={styles.freqs}>
        <legend className={styles.label}>頻率</legend>
        {FREQS.map((freq, index) => (
          <label key={freq} className={styles.freq}>
            <input
              ref={index === 0 ? firstFieldRef : undefined}
              type="radio"
              name={`${idPrefix}-freq`}
              value={freq}
              checked={value.freq === freq}
              onChange={() => onChange({ freq }, 'weekdays')}
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
            value={value.intervalText}
            onChange={(event) => onChange({ intervalText: event.target.value }, 'interval')}
            aria-invalid={errors.interval !== undefined}
            aria-describedby={errors.interval === undefined ? undefined : errorId('interval')}
          />
          {FREQ_LABELS[value.freq].unit}
        </div>
        {errors.interval !== undefined && (
          <p id={errorId('interval')} className={styles.error} role="alert">
            {errors.interval}
          </p>
        )}
      </div>

      {value.freq === 'weekly' && (
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
              return (
                <button
                  key={label}
                  type="button"
                  className={styles.weekday}
                  aria-pressed={(value.weekdays & bit) !== 0}
                  aria-label={`週${label}`}
                  onClick={() => onChange({ weekdays: value.weekdays ^ bit }, 'weekdays')}
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
    </div>
  )
}
