import type { MouseEvent } from 'react'
import Checkbox from './Checkbox'
import { formatRelativeDate, isOverdue } from '@/lib/date'
import { priorityLevel, type Task } from '@/lib/tasks'
import type { ApiError } from '@/lib/errors'
import styles from './TaskItem.module.css'

type Props = {
  task: Task
  selected: boolean
  onSelect: (id: number) => void
  onToggle: (task: Task) => Promise<ApiError | null>
}

export default function TaskItem({ task, selected, onSelect, onToggle }: Props) {
  const completed = task.completedAt !== null
  const level = priorityLevel(task.priority)

  function handleSelect() {
    onSelect(task.id)
  }

  function handleToggle() {
    void onToggle(task)
  }

  // 勾完成有自己的意思,不順便把這一列選起來
  function stopSelect(event: MouseEvent) {
    event.stopPropagation()
  }

  const classNames = [styles.item]
  if (completed) {
    classNames.push(styles.completed)
  }
  if (selected) {
    classNames.push(styles.selected)
  }

  return (
    // 整列可點選;標題另外是按鈕,鍵盤才走得到。
    // data-task-id / data-task-control:任務離開視圖時,ThreeColumnLayout 靠這兩個找焦點的來源與遞補的落點
    <li
      className={classNames.join(' ')}
      onClick={handleSelect}
      aria-current={selected}
      data-task-id={task.id}
    >
      <div className={styles.main}>
        {/* 任務列的優先級只靠顏色:未勾選時的框線色。文字標籤在右欄與新增列,
            螢幕閱讀器靠 aria-label。勾選後不分優先級一律同色 */}
        <Checkbox
          tone={level?.tone}
          checked={completed}
          onChange={handleToggle}
          onClick={stopSelect}
          data-task-control="checkbox"
          aria-label={
            level === undefined
              ? `完成「${task.title}」`
              : `完成「${task.title}」,優先級${level.label}`
          }
        />
        <button
          type="button"
          className={styles.title}
          onClick={handleSelect}
          data-task-control="row"
        >
          {task.title}
        </button>
      </div>

      <div className={styles.meta}>
        {/* dueDate 是日曆日,顯示成相對描述;逾期上警示色 */}
        {task.dueDate !== null && (
          <span
            className={
              isOverdue(task.dueDate) ? `${styles.dueDate} ${styles.overdue}` : styles.dueDate
            }
          >
            {formatRelativeDate(task.dueDate)}
          </span>
        )}
      </div>
    </li>
  )
}
