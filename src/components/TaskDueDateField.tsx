import { useState } from 'react'
import DueDateDialog from './DueDateDialog'
import { formatRelativeDate, isOverdue } from '@/lib/date'
import type { Task } from '@/lib/tasks'
import styles from './TaskDueDateField.module.css'

type Props = {
  id: string
  labelId: string
  task: Task
  onSave: (dueDate: string | null) => Promise<boolean>
  disabled: boolean
}

export default function TaskDueDateField({ id, labelId, task, onSave, disabled }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        id={id}
        type="button"
        className={
          task.dueDate !== null && isOverdue(task.dueDate)
            ? `${styles.trigger} ${styles.overdue}`
            : styles.trigger
        }
        onClick={() => setOpen(true)}
        disabled={disabled}
        // 讀出來是「截止日 2026-09-20」
        aria-labelledby={`${labelId} ${id}`}
      >
        {/* 相對描述;要看真正的日曆就開彈窗 */}
        {task.dueDate === null ? '無' : formatRelativeDate(task.dueDate)}
      </button>

      {/* 只在開啟時掛載:關閉即卸載,草稿跟著消失 */}
      {open && (
        <DueDateDialog
          dueDate={task.dueDate}
          onClose={() => setOpen(false)}
          onConfirm={(dueDate) => {
            setOpen(false)
            void onSave(dueDate)
          }}
        />
      )}
    </>
  )
}
