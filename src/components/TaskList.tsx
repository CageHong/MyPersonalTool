import NewTaskForm from './NewTaskForm'
import TaskItem from './TaskItem'
import styles from './TaskList.module.css'
import type { NewTask, Task } from '@/lib/tasks'

// 資料與寫入都在 ThreeColumnLayout,這裡只負責畫清單
type Props = {
  tasks: Task[]
  loading: boolean
  error: string | null
  mutating: boolean
  selectedId: number | null
  onSelect: (id: number) => void
  onCreate: (input: NewTask) => Promise<boolean>
  onToggle: (task: Task) => Promise<boolean>
  onDelete: (id: number) => Promise<boolean>
}

export default function TaskList({
  tasks,
  loading,
  error,
  mutating,
  selectedId,
  onSelect,
  onCreate,
  onToggle,
  onDelete,
}: Props) {
  return (
    <div className={styles.container}>
      <NewTaskForm onCreate={onCreate} disabled={mutating} />

      {error !== null && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {loading && <p className={styles.status}>載入中…</p>}

      {!loading && error === null && tasks.length === 0 && (
        <p className={styles.status}>還沒有任務</p>
      )}

      {tasks.length > 0 && (
        <ul className={styles.list}>
          {tasks.map((task) => (
            <TaskItem
              key={task.id}
              task={task}
              selected={task.id === selectedId}
              onSelect={onSelect}
              onToggle={onToggle}
              onDelete={onDelete}
              disabled={mutating}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
