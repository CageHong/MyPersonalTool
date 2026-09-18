import NewTaskForm from './NewTaskForm'
import TaskItem from './TaskItem'
import styles from './TaskList.module.css'
import type { RefObject } from 'react'
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
  // 每一列標題按鈕的 DOM,依畫面順序放進陣列;刪除後由 ThreeColumnLayout 拿來移焦點。
  // React 19 可以直接把 ref 當 prop 傳,不用 forwardRef
  titleRefs: RefObject<(HTMLButtonElement | null)[]>
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
  titleRefs,
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
          {tasks.map((task, index) => (
            <TaskItem
              key={task.id}
              task={task}
              selected={task.id === selectedId}
              onSelect={onSelect}
              onToggle={onToggle}
              disabled={mutating}
              // 行內箭頭函式每次 render 都是新的,React 會重新呼叫,索引跟著當次順序
              titleRef={(element) => {
                titleRefs.current[index] = element
              }}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
