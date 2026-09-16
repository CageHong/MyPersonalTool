import { useState } from 'react'
import ConfirmDialog from './ConfirmDialog'
import TaskDueDateField from './TaskDueDateField'
import TaskNotesField from './TaskNotesField'
import TaskPriorityField from './TaskPriorityField'
import TaskTitleField from './TaskTitleField'
import type { Task, TaskPatch } from '@/lib/tasks'
import styles from './TaskDetail.module.css'

// 四個欄位都可編輯;各自儲存,各自送一次 PATCH
type Props = {
  task: Task | undefined
  mutating: boolean
  onUpdate: (id: number, patch: TaskPatch) => Promise<boolean>
  onDelete: (id: number) => Promise<boolean>
}

export default function TaskDetail({ task, mutating, onUpdate, onDelete }: Props) {
  // 存「正在確認刪除哪一筆」而不是布林值:換任務自動失效,刪除成功或失敗後都清成 null
  const [confirmingId, setConfirmingId] = useState<number | null>(null)

  if (task === undefined) {
    return <p className={styles.empty}>未選取任務</p>
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
          onSave={(title) => onUpdate(task.id, { title })}
          disabled={mutating}
        />
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
          onSave={(notes) => onUpdate(task.id, { notes })}
          disabled={mutating}
        />
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
          onSave={(dueDate) => onUpdate(task.id, { dueDate })}
          disabled={mutating}
        />
      </div>

      <div className={styles.field}>
        {/* 一個 label 掛不到四顆 radio,改用 aria-labelledby 指過去 */}
        <span className={styles.fieldLabel} id="task-priority-label">
          優先級
        </span>
        <TaskPriorityField
          labelId="task-priority-label"
          task={task}
          onSave={(priority) => onUpdate(task.id, { priority })}
          disabled={mutating}
        />
      </div>
    </article>
  )
}
