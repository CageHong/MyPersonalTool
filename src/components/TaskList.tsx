import NewTaskForm from './NewTaskForm'
import TaskItem from './TaskItem'
import TaskListSkeleton from './TaskListSkeleton'
import styles from './TaskList.module.css'
import type { ApiError } from '@/lib/errors'
import type { NewTask, Task } from '@/lib/tasks'
import type { ViewId } from '@/lib/views'

// 空清單的三種情況,語氣不同:沒東西可看 vs 這個檢視沒東西 vs 還沒完成過任何事
function emptyMessage(totalCount: number, view: ViewId): string {
  if (totalCount === 0) {
    return '還沒有任務,從上方新增一筆'
  }
  if (view === 'done') {
    return '還沒有已完成的任務'
  }
  return '這個檢視目前沒有任務'
}

// 資料與寫入都在 ThreeColumnLayout,這裡只負責畫清單
type Props = {
  // 已經照目前檢視篩選過,重複實例已收合成每條規則一個代表
  tasks: Task[]
  // 代表的 id → 同規則還有幾個逾期的實例
  overdueCounts: Map<number, number>
  // 篩選前的總數與目前檢視:空狀態要分辨「一筆都沒有」和「這個檢視是空的」
  totalCount: number
  view: ViewId
  loading: boolean
  error: string | null
  selectedId: number | null
  onSelect: (id: number) => void
  onCreate: (input: NewTask) => Promise<ApiError | null>
  onToggle: (task: Task) => Promise<ApiError | null>
}

export default function TaskList({
  tasks,
  overdueCounts,
  totalCount,
  view,
  loading,
  error,
  selectedId,
  onSelect,
  onCreate,
  onToggle,
}: Props) {
  return (
    <div className={styles.container}>
      <NewTaskForm onCreate={onCreate} />

      {error !== null && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {/* 載入中就直接放骨架,和首屏的 PageSkeleton 是同一份;
          不再先顯示一行「載入中…」,免得畫面切換兩次 */}
      {loading && <TaskListSkeleton />}

      {!loading && error === null && tasks.length === 0 && (
        <p className={styles.status}>{emptyMessage(totalCount, view)}</p>
      )}

      {tasks.length > 0 && (
        <ul className={styles.list}>
          {tasks.map((task) => (
            <TaskItem
              key={task.id}
              task={task}
              overdueCount={overdueCounts.get(task.id) ?? 0}
              selected={task.id === selectedId}
              onSelect={onSelect}
              onToggle={onToggle}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
