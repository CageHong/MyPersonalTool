import type { MouseEvent, Ref } from 'react'
import { formatRelativeDate, isOverdue } from '@/lib/date'
import { priorityLevel, type Task } from '@/lib/tasks'
import styles from './TaskItem.module.css'

type Props = {
  task: Task
  selected: boolean
  onSelect: (id: number) => void
  onToggle: (task: Task) => Promise<boolean>
  disabled: boolean
  // 刪除後要把焦點放到遞補上來那一列的標題;取名 titleRef 講明指的是標題按鈕不是整列
  titleRef?: Ref<HTMLButtonElement>
}

export default function TaskItem({
  task,
  selected,
  onSelect,
  onToggle,
  disabled,
  titleRef,
}: Props) {
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
    // 整列可點選;標題另外是按鈕,鍵盤才走得到
    <li className={classNames.join(' ')} onClick={handleSelect} aria-current={selected}>
      <div className={styles.main}>
        <input
          type="checkbox"
          className={styles.checkbox}
          checked={completed}
          onChange={handleToggle}
          onClick={stopSelect}
          disabled={disabled}
          aria-label={`完成「${task.title}」`}
        />
        <button ref={titleRef} type="button" className={styles.title} onClick={handleSelect}>
          {task.title}
        </button>
      </div>

      <div className={styles.meta}>
        {/* 顏色只是輔助,文字標籤才是區分方式 */}
        {level !== undefined && (
          <span className={`${styles.priority} ${styles[level.tone]}`}>{level.label}</span>
        )}

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
