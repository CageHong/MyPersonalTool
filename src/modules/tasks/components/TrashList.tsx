import { useRef, useState, type ReactNode } from 'react'
import ConfirmDialog from './ConfirmDialog'
import RepeatIcon from './RepeatIcon'
import TaskListSkeleton from './TaskListSkeleton'
import { formatListDate, formatListDay } from '@/modules/tasks/lib/date'
import type { ApiError } from '@/modules/tasks/lib/errors'
import type { Task } from '@/modules/tasks/lib/tasks'
import { localDate } from '@/platform/date'
import styles from './TrashList.module.css'

// 垃圾桶視圖的中欄:唯讀清單,沒有新增列、沒有分組排序設定(decisions §6h)
type Props = {
  tasks: Task[]
  today: string
  loading: boolean
  error: string | null
  selectedId: number | null
  onSelect: (id: number) => void
  onEmpty: () => Promise<ApiError | null>
  leftToggle?: ReactNode
  rightToggle?: ReactNode
}

export default function TrashList({
  tasks,
  today,
  loading,
  error,
  selectedId,
  onSelect,
  onEmpty,
  leftToggle,
  rightToggle,
}: Props) {
  const [confirmingEmpty, setConfirmingEmpty] = useState(false)
  const emptyButtonRef = useRef<HTMLButtonElement>(null)

  return (
    <div className={styles.container}>
      <ConfirmDialog
        open={confirmingEmpty}
        title="清空垃圾桶?"
        description={`垃圾桶裡的 ${tasks.length} 筆任務會永久刪除,無法復原。`}
        confirmLabel="清空"
        onConfirm={async () => {
          await onEmpty()
          setConfirmingEmpty(false)
        }}
        onCancel={() => setConfirmingEmpty(false)}
        triggerRef={emptyButtonRef}
      />

      <header className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          {leftToggle}
          <h2 className={styles.viewTitle}>垃圾桶</h2>
        </div>
        <div className={styles.toolbarRight}>
          {!loading && tasks.length > 0 && (
            <button
              ref={emptyButtonRef}
              type="button"
              className={styles.emptyButton}
              onClick={() => setConfirmingEmpty(true)}
            >
              清空垃圾桶
            </button>
          )}
          {rightToggle}
        </div>
      </header>

      {error !== null && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {loading && <TaskListSkeleton />}

      {!loading && error === null && tasks.length === 0 && (
        <p className={styles.status}>垃圾桶是空的</p>
      )}

      {!loading && tasks.length > 0 && (
        <ul className={styles.list}>
          {tasks.map((task) => {
            const selected = task.id === selectedId
            const completed = task.completedAt !== null
            const classNames = [styles.item]
            if (completed) {
              classNames.push(styles.completed)
            }
            if (selected) {
              classNames.push(styles.selected)
            }
            const deletedDay =
              task.deletedAt != null
                ? formatListDay(localDate(new Date(task.deletedAt * 1000)), today)
                : null

            return (
              // data-task-id / data-task-control:沿用 ThreeColumnLayout 的焦點遞補與抽屜關閉歸還焦點
              <li
                key={task.id}
                className={classNames.join(' ')}
                onClick={() => onSelect(task.id)}
                aria-current={selected}
                data-task-id={task.id}
              >
                <div className={styles.main}>
                  <button
                    type="button"
                    className={styles.title}
                    onClick={() => onSelect(task.id)}
                    data-task-control="row"
                  >
                    {task.title}
                  </button>
                </div>

                <div className={styles.meta}>
                  {task.recurrenceRuleId !== null && (
                    <span className={styles.repeat} role="img" aria-label="重複">
                      <RepeatIcon />
                    </span>
                  )}
                  {task.dueDate !== null && (
                    <span className={styles.metaText}>{formatListDate(task.dueDate, today)}</span>
                  )}
                  {deletedDay !== null && (
                    <span className={styles.metaText}>刪除於 {deletedDay}</span>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
