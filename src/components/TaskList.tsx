import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
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

// 任務列離開清單時的退場列:畫在它原本的位置,淡出並收起高度後移除
type Exiting = { task: Task; index: number }

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

// 只看「有哪些列、什麼順序」;filterTasks 每次渲染都回傳新陣列,不能比參考
function signature(tasks: Task[]): string {
  return tasks.map((task) => task.id).join(',')
}

// 退場列插回原本的索引,和目前的列合成畫面上的順序
function withExiting(tasks: Task[], exiting: Exiting[]) {
  const rows: { task: Task; exiting: boolean }[] = tasks.map((task) => ({ task, exiting: false }))
  for (const { task, index } of [...exiting].sort((a, b) => a.index - b.index)) {
    rows.splice(Math.min(index, rows.length), 0, { task, exiting: true })
  }
  return rows
}

// 資料與寫入都在 ThreeColumnLayout,這裡只負責畫清單
type Props = {
  // 已經照目前檢視篩選過,重複實例已收合成每條規則一個代表
  tasks: Task[]
  // 代表的 id → 同規則還有幾個逾期的實例
  overdueCounts: Map<number, number>
  // 篩選前的全部任務:空狀態要分辨「一筆都沒有」和「這個檢視是空的」;
  // 退場列用它找最新狀態(剛勾完成的列以已勾選的樣子退場)
  allTasks: Task[]
  view: ViewId
  loading: boolean
  error: string | null
  selectedId: number | null
  onSelect: (id: number) => void
  onCreate: (input: NewTask) => Promise<ApiError | null>
  onToggle: (task: Task) => Promise<ApiError | null>
  // 今天與全部未完成時,ThreeColumnLayout 傳進來的習慣小區塊;畫在新增列與錯誤之後、任務清單之前
  habitBlock?: ReactNode
}

export default function TaskList({
  tasks,
  overdueCounts,
  allTasks,
  view,
  loading,
  error,
  selectedId,
  onSelect,
  onCreate,
  onToggle,
  habitBlock,
}: Props) {
  // 上一次畫出來的列,用來算出這次誰離開、誰進來。「prop 變了就調整 state」的寫法:
  // 在渲染中比對並 setState,退場列和新清單在同一次提交裡出現,
  // ThreeColumnLayout 在 flushSync 之後立刻移焦點時,DOM 已經是最終的樣子
  const [previous, setPrevious] = useState({ tasks, view, key: signature(tasks) })
  const [exiting, setExiting] = useState<Exiting[]>([])
  const [enteringIds, setEnteringIds] = useState<ReadonlySet<number>>(new Set())
  const listRef = useRef<HTMLUListElement>(null)

  const key = signature(tasks)
  if (key !== previous.key || view !== previous.view) {
    const currentIds = new Set(tasks.map((task) => task.id))
    const previousIds = new Set(previous.tasks.map((task) => task.id))
    // 換檢視、首次載入、減少動態時直接切換。前一輪還沒播完的退場列直接被新畫面取代
    const animate = view === previous.view && previous.tasks.length > 0 && !prefersReducedMotion()
    setExiting(
      animate
        ? previous.tasks.flatMap((task, index) => (currentIds.has(task.id) ? [] : [{ task, index }]))
        : [],
    )
    setEnteringIds(
      animate ? new Set(tasks.filter((task) => !previousIds.has(task.id)).map((task) => task.id)) : new Set(),
    )
    setPrevious({ tasks, view, key })
  }

  // 收起高度要從實際高度開始:先把目前高度寫成行內樣式,強制排版,再改成 0,transition 才接得上
  useLayoutEffect(() => {
    const list = listRef.current
    if (list === null) {
      return
    }
    for (const row of list.querySelectorAll<HTMLElement>('li[data-exiting]:not([data-collapsing])')) {
      row.style.height = `${row.getBoundingClientRect().height}px`
      void row.offsetHeight
      row.dataset.collapsing = ''
      row.style.height = '0px'
    }
  }, [exiting])

  function handleExited(id: number) {
    setExiting((current) => current.filter((item) => item.task.id !== id))
  }

  const latestById = new Map(allTasks.map((task) => [task.id, task]))
  const rows = withExiting(tasks, exiting)

  return (
    <div className={styles.container}>
      <NewTaskForm onCreate={onCreate} />

      {error !== null && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {habitBlock}

      {/* 載入中就直接放骨架,和首屏的 PageSkeleton 是同一份;
          不再先顯示一行「載入中…」,免得畫面切換兩次 */}
      {loading && <TaskListSkeleton />}

      {!loading && error === null && tasks.length === 0 && (
        <p className={styles.status}>{emptyMessage(allTasks.length, view)}</p>
      )}

      {rows.length > 0 && (
        <ul ref={listRef} className={styles.list}>
          {rows.map(({ task, exiting: leaving }) =>
            leaving ? (
              // 退場列:key 和一般列不同,任務若馬上回來也不會沿用這個收到 0 高的節點
              <TaskItem
                key={`exiting-${task.id}`}
                task={latestById.get(task.id) ?? task}
                overdueCount={0}
                selected={false}
                onSelect={onSelect}
                onToggle={onToggle}
                motion="exiting"
                onExited={() => handleExited(task.id)}
              />
            ) : (
              <TaskItem
                key={task.id}
                task={task}
                overdueCount={overdueCounts.get(task.id) ?? 0}
                selected={task.id === selectedId}
                onSelect={onSelect}
                onToggle={onToggle}
                motion={enteringIds.has(task.id) ? 'entering' : undefined}
              />
            ),
          )}
        </ul>
      )}
    </div>
  )
}
