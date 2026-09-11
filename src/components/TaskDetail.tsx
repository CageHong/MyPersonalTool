import TaskNotesField from './TaskNotesField'
import TaskPriorityField from './TaskPriorityField'
import TaskTitleField from './TaskTitleField'
import type { Task, TaskPatch } from '@/lib/tasks'
import styles from './TaskDetail.module.css'

// 標題、描述、優先級可編輯;截止日還是唯讀
type Props = {
  task: Task | undefined
  mutating: boolean
  onUpdate: (id: number, patch: TaskPatch) => Promise<boolean>
}

export default function TaskDetail({ task, mutating, onUpdate }: Props) {
  if (task === undefined) {
    return <p className={styles.empty}>未選取任務</p>
  }

  return (
    <article className={styles.detail}>
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
        <span className={styles.fieldLabel}>截止日</span>
        {/* dueDate 是日曆日,原樣顯示,不轉時間戳 */}
        <p className={task.dueDate === null ? styles.blank : undefined}>{task.dueDate ?? '—'}</p>
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
