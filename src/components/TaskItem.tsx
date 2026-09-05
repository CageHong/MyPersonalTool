import type { Task } from './TaskList'
import styles from './TaskItem.module.css'

type Props = {
  task: Task
  onToggle: (task: Task) => Promise<boolean>
  disabled: boolean
}

export default function TaskItem({ task, onToggle, disabled }: Props) {
  const completed = task.completedAt !== null

  return (
    <li className={completed ? `${styles.item} ${styles.completed}` : styles.item}>
      <label className={styles.label}>
        <input
          type="checkbox"
          className={styles.checkbox}
          checked={completed}
          onChange={() => void onToggle(task)}
          disabled={disabled}
        />
        <span className={styles.title}>{task.title}</span>
      </label>

      {/* dueDate 是日曆日,原樣顯示,不轉時間戳也不做時區換算 */}
      {task.dueDate !== null && <span className={styles.dueDate}>{task.dueDate}</span>}
    </li>
  )
}
