import { useState } from 'react'
import DueDateDialog from './DueDateDialog'
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
        className={styles.trigger}
        onClick={() => setOpen(true)}
        disabled={disabled}
        // 讀出來是「截止日 2026-09-20」
        aria-labelledby={`${labelId} ${id}`}
      >
        {/* dueDate 是日曆日,原樣顯示 */}
        {task.dueDate ?? '無'}
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
