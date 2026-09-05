import { priorityLevel, type Task } from './TaskList'
import styles from './TaskItem.module.css'

type Props = {
  task: Task
  onToggle: (task: Task) => Promise<boolean>
  onDelete: (id: number) => Promise<boolean>
  disabled: boolean
}

export default function TaskItem({ task, onToggle, onDelete, disabled }: Props) {
  const completed = task.completedAt !== null
  const level = priorityLevel(task.priority)

  // 目前直接刪,沒有二次確認;要加確認或改軟刪除時只動這個函式
  function handleDelete() {
    void onDelete(task.id)
  }

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

      <div className={styles.meta}>
        {/* 顏色只是輔助,文字標籤才是區分方式 */}
        {level !== undefined && (
          <span className={`${styles.priority} ${styles[level.tone]}`}>{level.label}</span>
        )}

        {/* dueDate 是日曆日,原樣顯示,不轉時間戳也不做時區換算 */}
        {task.dueDate !== null && <span className={styles.dueDate}>{task.dueDate}</span>}

        <button
          type="button"
          className={styles.delete}
          onClick={handleDelete}
          disabled={disabled}
          aria-label={`刪除「${task.title}」`}
        >
          刪除
        </button>
      </div>
    </li>
  )
}
