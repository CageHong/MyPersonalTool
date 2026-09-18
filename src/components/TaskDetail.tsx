import { useId, useState } from 'react'
import ConfirmDialog from './ConfirmDialog'
import TaskDueDateField from './TaskDueDateField'
import TaskNotesField from './TaskNotesField'
import TaskPriorityField from './TaskPriorityField'
import TaskTitleField from './TaskTitleField'
import { fieldMessage, type ApiError, type FieldErrors } from '@/lib/errors'
import type { Task, TaskPatch } from '@/lib/tasks'
import styles from './TaskDetail.module.css'

// 四個欄位都可編輯;各自儲存,各自送一次 PATCH
type Props = {
  task: Task | undefined
  mutating: boolean
  onUpdate: (id: number, patch: TaskPatch) => Promise<ApiError | null>
  onDelete: (id: number) => Promise<ApiError | null>
}

export default function TaskDetail({ task, mutating, onUpdate, onDelete }: Props) {
  // 存「正在確認刪除哪一筆」而不是布林值:換任務自動失效,刪除成功或失敗後都清成 null
  const [confirmingId, setConfirmingId] = useState<number | null>(null)
  // 欄位錯誤集中放這一層:訊息畫在欄位下方的 .field 裡,四個欄位共用同一套。
  // 生命週期綁在掛載上:ThreeColumnLayout 用 key={task.id} 渲染這個元件,
  // 換任務就重新掛載,狀態自動回到 {},這裡不必再分辨錯誤屬於哪一筆
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  // 訊息元素的 id 不寫死,同一頁出現兩個右欄也不會撞
  const errorIdPrefix = useId()

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
      <div className={styles.header}>
        {/* 目前是硬刪除,所以需要確認;改成軟刪除後可拿掉確認,改成復原提示 */}
        <button
          type="button"
          className={styles.delete}
          onClick={() => setConfirmingId(task.id)}
          disabled={mutating}
          aria-label={`刪除「${task.title}」`}
        >
          刪除
        </button>
      </div>

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
      />

      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="task-title">
          標題
        </label>
        {/* key 換掉 = 換任務就重新掛載,編輯到一半的值不會殘留到下一筆 */}
        <TaskTitleField
          key={task.id}
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
          key={task.id}
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
        {/* 觸發的是按鈕不是 input,htmlFor 掛不上,用 aria-labelledby 指過去 */}
        <span className={styles.fieldLabel} id="task-due-date-label">
          截止日
        </span>
        {/* key 換掉 = 換任務就重新掛載,彈窗與草稿不會留到下一筆 */}
        <TaskDueDateField
          key={task.id}
          id="task-due-date"
          labelId="task-due-date-label"
          task={task}
          onSave={(dueDate) => saveField('dueDate', { dueDate })}
          disabled={mutating}
        />
        {fieldError('dueDate')}
      </div>

      <div className={styles.field}>
        {/* 一個 label 掛不到四顆 radio,改用 aria-labelledby 指過去 */}
        <span className={styles.fieldLabel} id="task-priority-label">
          優先級
        </span>
        <TaskPriorityField
          labelId="task-priority-label"
          task={task}
          onSave={(priority) => saveField('priority', { priority })}
          disabled={mutating}
        />
        {fieldError('priority')}
      </div>
    </article>
  )
}
