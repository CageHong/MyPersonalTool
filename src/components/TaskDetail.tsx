import TaskNotesField from './TaskNotesField'
import TaskTitleField from './TaskTitleField'
import { priorityLevel, type Task, type TaskPatch } from '@/lib/tasks'
import styles from './TaskDetail.module.css'

// 標題與描述可編輯;截止日與優先級還是唯讀
type Props = {
  task: Task | undefined
  mutating: boolean
  onUpdate: (id: number, patch: TaskPatch) => Promise<boolean>
}

export default function TaskDetail({ task, mutating, onUpdate }: Props) {
  if (task === undefined) {
    return <p className={styles.empty}>未選取任務</p>
  }

  const level = priorityLevel(task.priority)

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
        <span className={styles.fieldLabel}>優先級</span>
        <p className={level === undefined ? styles.blank : styles[level.tone]}>
          {level?.label ?? '無'}
        </p>
      </div>
    </article>
  )
}
