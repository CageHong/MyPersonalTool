import { useId, useRef, useState } from 'react'
import ConfirmDialog from './ConfirmDialog'
import { fieldMessage, type ApiError, type FieldErrors } from '@/modules/tasks/lib/errors'
import { PERIOD_OPTIONS, streakLabel, type HabitItem, type HabitPatch } from '@/modules/tasks/lib/habitView'
import { useDraft } from '@/modules/tasks/lib/useDraft'
import styles from './HabitDetail.module.css'

// 習慣的編輯面板。欄位各自儲存,各自送一次 PATCH(同 TaskDetail)。
// ThreeColumnLayout 以 key={habit.id} 掛載:換習慣時草稿、錯誤、確認彈窗隨卸載清除
type Props = {
  habit: HabitItem | undefined
  onUpdate: (id: number, patch: HabitPatch) => Promise<ApiError | null>
  onTogglePause: (habit: HabitItem) => Promise<ApiError | null>
  onDelete: (id: number) => Promise<ApiError | null>
}

// 目標次數的輸入框是字串:空白 = 紀錄型(null);看起來不是數字的原樣送出,由伺服器回欄位錯誤。
// 不能交給 Number():Number('abc') 是 NaN,JSON 會把它變成 null,默默改成紀錄型
function parseTarget(value: string): number | string | null {
  const trimmed = value.trim()
  if (trimmed === '') {
    return null
  }
  const number = Number(trimmed)
  return Number.isFinite(number) ? number : trimmed
}

export default function HabitDetail({ habit, ...handlers }: Props) {
  if (habit === undefined) {
    return <p className={styles.empty}>未選取習慣</p>
  }
  return <HabitEditor habit={habit} {...handlers} />
}

// 拆出來讓 hook 與欄位的閉包都拿到確定存在的 habit
function HabitEditor({ habit, onUpdate, onTogglePause, onDelete }: Props & { habit: HabitItem }) {
  // 存正在確認刪除哪一筆,不存布林值(同 TaskDetail)
  const [confirmingId, setConfirmingId] = useState<number | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const errorIdPrefix = useId()
  const deleteButtonRef = useRef<HTMLButtonElement>(null)
  // 停止/重新開始的請求還沒回來時擋掉第二次:連點會變成「已停止時再停止」被伺服器拒絕。
  // 不停用按鈕:它就是焦點所在,停用會把焦點丟到 body
  const pausePendingRef = useRef(false)

  const habitId = habit.id
  const errorId = (field: string) => `${errorIdPrefix}-${field}`

  async function saveField(field: string, patch: HabitPatch): Promise<ApiError | null> {
    const failure = await onUpdate(habitId, patch)
    setFieldErrors((current) => {
      const next = { ...current }
      delete next[field]
      if (failure?.kind === 'fields') {
        Object.assign(next, failure.fields)
      }
      return next
    })
    return failure
  }

  const name = useDraft(habit.name, (value) => saveField('name', { name: value }))
  // 型別上 target 是 number | null;不是數字的字串照送,讓伺服器回 target.invalid_value
  const target = useDraft(habit.target === null ? '' : String(habit.target), (value) =>
    saveField('target', { target: parseTarget(value) as number | null }),
  )

  function clearFieldError(field: string) {
    setFieldErrors((current) => {
      if (current[field] === undefined) {
        return current
      }
      const next = { ...current }
      delete next[field]
      return next
    })
  }

  function fieldError(field: string) {
    const code = fieldErrors[field]
    if (code === undefined) {
      return null
    }
    return (
      <p id={errorId(field)} className={styles.fieldError} role="alert">
        {fieldMessage(field, code)}
      </p>
    )
  }

  function togglePause() {
    if (pausePendingRef.current) {
      return
    }
    pausePendingRef.current = true
    void onTogglePause(habit).finally(() => {
      pausePendingRef.current = false
    })
  }

  return (
    <article className={styles.detail} data-habit-id={habit.id}>
      <ConfirmDialog
        open={confirmingId === habit.id}
        title="刪除習慣?"
        description={`「${habit.name}」與它的 ${habit.totalLogs} 筆紀錄會一併刪除,無法復原。要保留紀錄請改用停止。`}
        confirmLabel="刪除"
        onConfirm={async () => {
          await onDelete(habitId)
          setConfirmingId(null)
        }}
        onCancel={() => setConfirmingId(null)}
        triggerRef={deleteButtonRef}
      />

      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="habit-name">
          名稱
        </label>
        <input
          id="habit-name"
          type="text"
          className={fieldErrors.name === undefined ? styles.input : `${styles.input} ${styles.invalid}`}
          value={name.value}
          onFocus={name.onFocus}
          onChange={(event) => {
            name.onChange(event.target.value)
            clearFieldError('name')
          }}
          onBlur={name.onBlur}
          aria-invalid={fieldErrors.name !== undefined || undefined}
          aria-describedby={fieldErrors.name !== undefined ? errorId('name') : undefined}
        />
        {fieldError('name')}
      </div>

      <div className={styles.field}>
        <span className={styles.fieldLabel} id={`${errorIdPrefix}-period`}>
          頻率
        </span>
        {/* 點選即存(同優先級);點目前的值不送 */}
        <div className={styles.options} role="group" aria-labelledby={`${errorIdPrefix}-period`}>
          {PERIOD_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={styles.option}
              aria-pressed={option.value === habit.periodType}
              onClick={() => {
                if (option.value !== habit.periodType) {
                  void saveField('periodType', { periodType: option.value })
                }
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="habit-target">
          目標次數
        </label>
        <input
          id="habit-target"
          type="number"
          min={1}
          step={1}
          className={fieldErrors.target === undefined ? styles.input : `${styles.input} ${styles.invalid}`}
          value={target.value}
          placeholder="只記錄次數"
          onFocus={target.onFocus}
          onChange={(event) => {
            target.onChange(event.target.value)
            clearFieldError('target')
          }}
          onBlur={target.onBlur}
          aria-invalid={fieldErrors.target !== undefined || undefined}
          aria-describedby={fieldErrors.target !== undefined ? errorId('target') : `${errorIdPrefix}-target-hint`}
        />
        <p id={`${errorIdPrefix}-target-hint`} className={styles.hint}>
          留空代表只記錄次數,不算連續紀錄
        </p>
        {fieldError('target')}
      </div>

      <div className={styles.stats}>
        <span>全期累計 {habit.totalLogs} 次</span>
        {/* 紀錄型沒有 streak */}
        {habit.target !== null && habit.streak !== null && <span>{streakLabel(habit.periodType, habit.streak)}</span>}
      </div>

      {/* 同一個按鈕原地換文字與動作:停止後焦點留在這裡,習慣移到「已停止」也不會掉到 body */}
      <div>
        <button type="button" className={styles.button} onClick={togglePause}>
          {habit.paused ? '重新開始' : '停止'}
        </button>
      </div>

      <div className={styles.footer}>
        <button
          ref={deleteButtonRef}
          type="button"
          className={styles.delete}
          onClick={() => setConfirmingId(habit.id)}
          aria-label={`刪除「${habit.name}」`}
        >
          刪除
        </button>
      </div>
    </article>
  )
}
