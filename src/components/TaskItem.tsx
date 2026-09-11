import type { MouseEvent } from 'react'
import { priorityLevel, type Task } from '@/lib/tasks'
import styles from './TaskItem.module.css'

type Props = {
  task: Task
  selected: boolean
  onSelect: (id: number) => void
  onToggle: (task: Task) => Promise<boolean>
  onDelete: (id: number) => Promise<boolean>
  disabled: boolean
}

export default function TaskItem({
  task,
  selected,
  onSelect,
  onToggle,
  onDelete,
  disabled,
}: Props) {
  const completed = task.completedAt !== null
  const level = priorityLevel(task.priority)

  function handleSelect() {
    onSelect(task.id)
  }

  function handleToggle() {
    void onToggle(task)
  }

  // 勾完成與刪除有自己的意思,不順便把這一列選起來
  function stopSelect(event: MouseEvent) {
    event.stopPropagation()
  }

  // 目前直接刪,沒有二次確認;要加確認或改軟刪除時只動這個函式
  function handleDelete(event: MouseEvent) {
    stopSelect(event)
    void onDelete(task.id)
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
        <button type="button" className={styles.title} onClick={handleSelect}>
          {task.title}
        </button>
      </div>

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
