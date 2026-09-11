import { priorityLevel, type Task } from '@/lib/tasks'
import styles from './TaskDetail.module.css'

// 這一步只做唯讀顯示;編輯與 PATCH 是下一步
type Props = {
  task: Task | undefined
}

export default function TaskDetail({ task }: Props) {
  if (task === undefined) {
    return <p className={styles.empty}>未選取任務</p>
  }

  const level = priorityLevel(task.priority)

  return (
    <article className={styles.detail}>
      <h2 className={styles.title}>{task.title}</h2>

      <div className={styles.field}>
        <span className={styles.fieldLabel}>描述</span>
        {/* 純文字,不做 Markdown 渲染;換行照原樣(CSS 的 white-space) */}
        <p className={task.notes === null ? styles.blank : styles.notes}>{task.notes ?? '—'}</p>
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
