import { useId, useRef, useState } from 'react'
import ConfirmDialog from './ConfirmDialog'
import DueDateDialog from './DueDateDialog'
import DueDateTrigger from './DueDateTrigger'
import PriorityMenu from './PriorityMenu'
import RecurrenceSummary, { useRecurrenceRule } from './RecurrenceSummary'
import TaskChecklist from './TaskChecklist'
import TaskNotesField from './TaskNotesField'
import TaskTitleField from './TaskTitleField'
import { fieldMessage, type ApiError, type FieldErrors } from '@/lib/errors'
import type { RecurrenceRequest } from '@/lib/recurrenceDraft'
import type { Task, TaskPatch } from '@/lib/tasks'
import styles from './TaskDetail.module.css'

// 四個欄位都可編輯;各自儲存,各自送一次 PATCH。checklist 自己打自己的 API
type Props = {
  task: Task | undefined
  onUpdate: (id: number, patch: TaskPatch) => Promise<ApiError | null>
  onDelete: (id: number) => Promise<ApiError | null>
  // 日期選單按確定:截止日與重複規則一起存(先日期、再規則);undefined = 那一項沒有改
  onSaveDate: (
    id: number,
    dueDate: string | null | undefined,
    recurrence: RecurrenceRequest | undefined,
  ) => Promise<ApiError | null>
  // 任務清單的重抓次數;實例的規則跟著它重抓
  tasksVersion: number
  // checklist 的泛用錯誤顯示在中欄新增列下方,和任務的錯誤同一個位置
  onChecklistError: (message: string | null) => void
}

export default function TaskDetail({
  task,
  onUpdate,
  onDelete,
  onSaveDate,
  tasksVersion,
  onChecklistError,
}: Props) {
  // 存「正在確認刪除哪一筆」而不是布林值:換任務自動失效,刪除成功或失敗後都清成 null
  const [confirmingId, setConfirmingId] = useState<number | null>(null)
  // 欄位錯誤集中放這一層:訊息畫在欄位下方的 .field 裡,四個欄位共用同一套。
  // 生命週期綁在掛載上:ThreeColumnLayout 用 key={task.id} 渲染這個元件,
  // 換任務就重新掛載,狀態自動回到 {},這裡不必再分辨錯誤屬於哪一筆
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  // 訊息元素的 id 不寫死,同一頁出現兩個右欄也不會撞
  const errorIdPrefix = useId()
  // 刪除確認取消(或刪除失敗)後焦點回到刪除鈕
  const deleteButtonRef = useRef<HTMLButtonElement>(null)
  // 日期選單有兩個觸發鈕:截止日(A)與實例的規則摘要(B)。記住是哪一個打開的,關閉時焦點回到它。
  // 兩個觸發鈕在送出後都還在(建立規則後摘要列才出現,但 A 一直都在),焦點不會掉到 body
  const [dateMenuOpener, setDateMenuOpener] = useState<'date' | 'summary' | null>(null)
  const dateTriggerRef = useRef<HTMLButtonElement>(null)
  const summaryTriggerRef = useRef<HTMLButtonElement>(null)
  // 寫入排隊期間觸發鈕還在,可以再開一次再送一次;不停用按鈕,用 ref 擋掉第二次送出。完成後一律重設
  const dateSavePendingRef = useRef(false)
  // 同一件事的 state 版本,給畫面用:寫入進行中時規則資料還是舊的(重抓還沒發生、版本還沒變),
  // 這段期間日期選單不能拿它組請求
  const [savingDate, setSavingDate] = useState(false)
  // 實例的規則:摘要與日期選單的初始草稿共用。一般任務是 null
  const ruleSnapshot = useRecurrenceRule(task?.recurrenceRuleId ?? null, tasksVersion, onChecklistError)
  // 摘要:重抓中照舊顯示上一份結果,避免每次寫入都閃一下「載入中」
  const ruleState = ruleSnapshot?.state ?? null
  // 日期選單:從送出到規則重抓回來的整段期間都當成載入中,選單的重複草稿等新資料到了才建立,
  // 不拿過期的規則組請求(例如停止之後馬上打開,舊資料還說規則進行中)
  const dialogRuleState =
    savingDate || ruleSnapshot?.stale ? ({ status: 'loading' } as const) : ruleState

  if (task === undefined) {
    return <p className={styles.empty}>未選取任務</p>
  }

  // 早退之後 task 一定存在;閉包裡用這個區域常數,型別才不會退回 undefined
  const taskId = task.id
  const errorId = (field: string) => `${errorIdPrefix}-${field}`

  // 每個欄位各自送一次 PATCH:欄位錯誤留在這一層,成功或泛用錯誤就清掉這個欄位的訊息
  async function saveField(field: string, patch: TaskPatch): Promise<ApiError | null> {
    const failure = await onUpdate(taskId, patch)
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

  // 日期選單:日期被拒時欄位錯誤畫在截止日下方;規則的錯誤是泛用錯誤,顯示在中欄新增列下方
  async function saveDate(
    dueDate: string | null | undefined,
    recurrence: RecurrenceRequest | undefined,
  ): Promise<ApiError | null> {
    const failure = await onSaveDate(taskId, dueDate, recurrence)
    setFieldErrors((current) => {
      const next = { ...current }
      delete next.dueDate
      if (failure?.kind === 'fields') {
        Object.assign(next, failure.fields)
      }
      return next
    })
    return failure
  }

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

  // 有錯誤才畫訊息;沒有錯誤時連元素都不存在,aria-describedby 也不會指過來
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

  return (
    // data-task-id:任務離開視圖時,ThreeColumnLayout 靠它認出焦點原本在右欄的哪個任務
    <article className={styles.detail} data-task-id={task.id}>
      <ConfirmDialog
        open={confirmingId === task.id}
        title="刪除任務?"
        description={`「${task.title}」刪除後無法復原。`}
        confirmLabel="刪除"
        // 失敗時 handleDelete 已經 setError,任務與選取不動;成功或失敗都關閉彈窗
        onConfirm={async () => {
          await onDelete(task.id)
          setConfirmingId(null)
        }}
        onCancel={() => setConfirmingId(null)}
        triggerRef={deleteButtonRef}
      />

      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="task-title">
          標題
        </label>
        <TaskTitleField
          id="task-title"
          task={task}
          onSave={(title) => saveField('title', { title })}
          errorId={errorId('title')}
          invalid={fieldErrors.title !== undefined}
          onClearError={() => clearFieldError('title')}
        />
        {fieldError('title')}
      </div>

      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="task-notes">
          描述
        </label>
        {/* 純文字,不做 Markdown 渲染 */}
        <TaskNotesField
          id="task-notes"
          task={task}
          onSave={(notes) => saveField('notes', { notes })}
          errorId={errorId('notes')}
          invalid={fieldErrors.notes !== undefined}
          onClearError={() => clearFieldError('notes')}
        />
        {fieldError('notes')}
      </div>

      <div className={styles.field}>
        <span className={styles.fieldLabel} id={`${errorIdPrefix}-checklist-label`}>
          檢查項目
        </span>
        <TaskChecklist
          taskId={task.id}
          onError={onChecklistError}
          labelId={`${errorIdPrefix}-checklist-label`}
        />
      </div>

      {/* 觸發鈕的字級比輸入框小一階;觸發鈕是 font: inherit,跟著這層走。
          標籤只是視覺用,觸發鈕自己的 aria-label 已經帶欄位名與目前值 */}
      <div className={`${styles.field} ${styles.menuField}`}>
        <span className={styles.fieldLabel}>截止日</span>
        <DueDateTrigger
          ref={dateTriggerRef}
          value={task.dueDate}
          showEmpty
          onClick={() => setDateMenuOpener('date')}
        />
        {fieldError('dueDate')}
      </div>

      <div className={`${styles.field} ${styles.menuField}`}>
        <span className={styles.fieldLabel}>優先級</span>
        <PriorityMenu
          value={task.priority}
          onSelect={(priority) => void saveField('priority', { priority })}
          showValue
        />
        {fieldError('priority')}
      </div>

      {/* 實例才有這一列:目前的規則摘要,點它開啟日期選單(重複設定在那裡改) */}
      {ruleState !== null && (
        <div className={`${styles.field} ${styles.menuField}`}>
          <span className={styles.fieldLabel}>重複</span>
          <RecurrenceSummary
            ref={summaryTriggerRef}
            state={ruleState}
            onClick={() => setDateMenuOpener('summary')}
          />
        </div>
      )}

      {/* 只在開啟時掛載:關閉即卸載,草稿跟著消失。已完成的任務不傳 recurrence,選單只有日期 */}
      {dateMenuOpener !== null && (
        <DueDateDialog
          dueDate={task.dueDate}
          recurrence={task.completedAt === null ? { rule: dialogRuleState } : undefined}
          // 對話框已經 close(),背景不再 inert,觸發鈕才聚焦得到。先移焦點再存:
          // 儲存時記錄的焦點位置才會是右欄,任務因此離開視圖時才找得到遞補列
          onClose={(result) => {
            const opener = dateMenuOpener === 'summary' ? summaryTriggerRef : dateTriggerRef
            setDateMenuOpener(null)
            opener.current?.focus()
            if (result === null || dateSavePendingRef.current) {
              return
            }
            // 內容沒變不送請求
            const dueDate = result.dueDate !== task.dueDate ? result.dueDate : undefined
            const recurrence = result.recurrence ?? undefined
            if (dueDate === undefined && recurrence === undefined) {
              return
            }
            dateSavePendingRef.current = true
            setSavingDate(true)
            void saveDate(dueDate, recurrence).finally(() => {
              dateSavePendingRef.current = false
              setSavingDate(false)
            })
          }}
        />
      )}

      {/* 刪除放在最底部,和編輯欄位隔開 */}
      <div className={styles.footer}>
        {/* 目前是硬刪除,所以需要確認;改成軟刪除後可拿掉確認,改成復原提示 */}
        <button
          ref={deleteButtonRef}
          type="button"
          className={styles.delete}
          onClick={() => setConfirmingId(task.id)}
          aria-label={`刪除「${task.title}」`}
        >
          刪除
        </button>
      </div>
    </article>
  )
}
