import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import NewTaskForm from './NewTaskForm'
import TaskItem from './TaskItem'
import TaskListSkeleton from './TaskListSkeleton'
import ViewSettingsMenu from './ViewSettingsMenu'
import styles from './TaskList.module.css'
import type { ApiError } from '@/modules/tasks/lib/errors'
import type { Section, ViewSettings } from '@/modules/tasks/lib/listView'
import type { NewTask, Task } from '@/modules/tasks/lib/tasks'
import { VIEWS, type ViewId } from '@/modules/tasks/lib/views'

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

type Row = { task: Task; exiting: boolean }

// 退場列插回原本的索引,和目前的列合成畫面上的順序
function withExiting(tasks: Task[], exiting: Exiting[]): Row[] {
  const rows: Row[] = tasks.map((task) => ({ task, exiting: false }))
  for (const { task, index } of [...exiting].sort((a, b) => a.index - b.index)) {
    rows.splice(Math.min(index, rows.length), 0, { task, exiting: true })
  }
  return rows
}

// 畫面上的一塊:一個區塊的標題加它底下的列。section 為 null 的是開頭只有退場列的那一塊
type Block = { section: Section | null; rows: Row[] }

// 把攤平的列切回區塊。退場列已經不屬於任何區塊,留在它原本位置所在的那一塊裡收掉;
// 遇到屬於下一個區塊的列才開新的一塊
function toBlocks(rows: Row[], sections: Section[]): Block[] {
  const sectionOf = new Map<number, Section>()
  for (const section of sections) {
    for (const task of section.tasks) {
      sectionOf.set(task.id, section)
    }
  }

  const blocks: Block[] = []
  for (const row of rows) {
    const section = row.exiting ? null : (sectionOf.get(row.task.id) ?? null)
    const last = blocks.at(-1)
    if (last === undefined || (section !== null && section !== last.section)) {
      blocks.push({ section, rows: [row] })
    } else {
      last.rows.push(row)
    }
  }
  return blocks
}

// 資料與寫入都在 ThreeColumnLayout,這裡只負責畫清單
type Props = {
  // 已經照目前檢視篩選過、重複實例已收合成每條規則一個代表,再依清單設定排成區塊(置頂、分組、排序)。
  // 區塊由上到下攤平就是畫面上的列順序
  sections: Section[]
  // 目前清單的分組與排序設定;改動時整份交回去存
  settings: ViewSettings
  onChangeSettings: (next: ViewSettings) => void
  // 代表的 id → 同規則還有幾個逾期的實例
  overdueCounts: Map<number, number>
  // 篩選前的全部任務:空狀態要分辨「一筆都沒有」和「這個檢視是空的」;
  // 退場列用它找最新狀態(剛勾完成的列以已勾選的樣子退場)
  allTasks: Task[]
  view: ViewId
  today: string
  loading: boolean
  error: string | null
  selectedId: number | null
  onSelect: (id: number) => void
  onCreate: (input: NewTask) => Promise<ApiError | null>
  onCreateMany: (inputs: NewTask[]) => Promise<ApiError | null>
  onToggle: (task: Task) => Promise<ApiError | null>
  // 今天與全部未完成時,ThreeColumnLayout 傳進來的習慣小區塊;畫在新增列與錯誤之後、任務清單之前
  habitBlock?: ReactNode
  leftToggle?: ReactNode
  rightToggle?: ReactNode
}

export default function TaskList({
  sections,
  settings,
  onChangeSettings,
  overdueCounts,
  allTasks,
  view,
  today,
  loading,
  error,
  selectedId,
  onSelect,
  onCreate,
  onCreateMany,
  onToggle,
  habitBlock,
  leftToggle,
  rightToggle,
}: Props) {
  const tasks = sections.flatMap((section) => section.tasks)
  // 上一次畫出來的列,用來算出這次誰離開、誰進來。「prop 變了就調整 state」的寫法:
  // 在渲染中比對並 setState,退場列和新清單在同一次提交裡出現,
  // ThreeColumnLayout 在 flushSync 之後立刻移焦點時,DOM 已經是最終的樣子
  const [previous, setPrevious] = useState({ tasks, view, key: signature(tasks) })
  const [exiting, setExiting] = useState<Exiting[]>([])
  const [enteringIds, setEnteringIds] = useState<ReadonlySet<number>>(new Set())
  // 各區塊各有一個 <ul>,退場列散在其中;從包住全部區塊的這一層找
  const listRef = useRef<HTMLDivElement>(null)

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
  const blocks = toBlocks(withExiting(tasks, exiting), sections)
  const viewLabel = VIEWS.find((item) => item.id === view)?.label ?? ''

  return (
    <div className={styles.container}>
      {/* 標題列:左端是左欄切換鈕與清單名稱,右端是分組排序與右欄切換鈕 */}
      <header className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          {leftToggle}
          <h2 className={styles.viewTitle}>{viewLabel}</h2>
        </div>
        <div className={styles.toolbarRight}>
          <ViewSettingsMenu settings={settings} onChange={onChangeSettings} />
          {rightToggle}
        </div>
      </header>

      <NewTaskForm today={today} onCreate={onCreate} onCreateMany={onCreateMany} />

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

      {blocks.length > 0 && (
        <div ref={listRef} className={styles.sections}>
          {blocks.map((block, blockIndex) => (
            <section
              // 只有退場列的那一塊沒有區塊可以當 key;它最多一塊(在最前面)
              key={block.section?.key ?? `exiting-${blockIndex}`}
              className={styles.section}
            >
              {/* 筆數是區塊裡現有的任務數:置頂的已經抽走,退場中的不算 */}
              {block.section !== null && block.section.label !== null && (
                <h3 className={styles.sectionTitle}>
                  <span className={styles.sectionName}>{block.section.label}</span>
                  <span>{block.section.tasks.length}</span>
                </h3>
              )}
              <ul className={styles.list}>
                {block.rows.map(({ task, exiting: leaving }) =>
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
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
