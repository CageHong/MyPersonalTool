import { useId, useRef, useState } from 'react'
import ConfirmDialog from './ConfirmDialog'
import DueDateMenu from './DueDateMenu'
import PriorityMenu from './PriorityMenu'
import TaskChecklist from './TaskChecklist'
import TaskNotesField from './TaskNotesField'
import TaskTitleField from './TaskTitleField'
import { fieldMessage, type ApiError, type FieldErrors } from '@/lib/errors'
import type { Task, TaskPatch } from '@/lib/tasks'
import styles from './TaskDetail.module.css'

// 四個欄位都可編輯;各自儲存,各自送一次 PATCH。checklist 自己打自己的 API
type Props = {
  task: Task | undefined
  mutating: boolean
  onUpdate: (id: number, patch: TaskPatch) => Promise<ApiError | null>
  onDelete: (id: number) => Promise<ApiError | null>
  // checklist 的泛用錯誤顯示在中欄新增列下方,和任務的錯誤同一個位置
  onChecklistError: (message: string | null) => void
}

export default function TaskDetail({
  task,
  mutating,
  onUpdate,
  onDelete,
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
    <article className={styles.detail}>
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
          disabled={mutating}
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
          disabled={mutating}
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

      {/* 兩個觸發鈕的字級比輸入框小一階;觸發鈕是 font: inherit,跟著這層走。
          標籤只是視覺用,觸發鈕自己的 aria-label 已經帶欄位名與目前值 */}
      <div className={`${styles.field} ${styles.menuField}`}>
        <span className={styles.fieldLabel}>截止日</span>
        <DueDateMenu
          value={task.dueDate}
          onSelect={(dueDate) => void saveField('dueDate', { dueDate })}
          disabled={mutating}
          showEmpty
        />
        {fieldError('dueDate')}
      </div>

      <div className={`${styles.field} ${styles.menuField}`}>
        <span className={styles.fieldLabel}>優先級</span>
        <PriorityMenu
          value={task.priority}
          onSelect={(priority) => void saveField('priority', { priority })}
          disabled={mutating}
          showValue
        />
        {fieldError('priority')}
      </div>

      {/* 刪除放在最底部,和編輯欄位隔開 */}
      <div className={styles.footer}>
        {/* 目前是硬刪除,所以需要確認;改成軟刪除後可拿掉確認,改成復原提示 */}
        <button
          ref={deleteButtonRef}
          type="button"
          className={styles.delete}
          onClick={() => setConfirmingId(task.id)}
          disabled={mutating}
          aria-label={`刪除「${task.title}」`}
        >
          刪除
        </button>
      </div>
    </article>
  )
}
