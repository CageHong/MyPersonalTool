import type { Ref } from 'react'
import CalendarIcon from './CalendarIcon'
import { formatListDate, isOverdue } from '@/modules/tasks/lib/date'
import styles from './DueDateMenu.module.css'

type Props = {
  value: string | null
  // 右欄要讀得出目前狀態,空值顯示淡色「無」;新增列空值是預設,只放圖示
  showEmpty: boolean
  onClick: () => void
  ref?: Ref<HTMLButtonElement>
}

// 截止日的觸發鈕;新增列(DueDateMenu)與右欄(TaskDetail)共用同一個外觀
export default function DueDateTrigger({ value, showEmpty, onClick, ref }: Props) {
  const classNames = [styles.trigger]
  if (value === null) {
    classNames.push(styles.empty)
  } else if (isOverdue(value)) {
    classNames.push(styles.overdue)
  }

  // 和中欄任務列同一種寫法
  const label = value === null ? '無' : formatListDate(value)

  return (
    <button
      ref={ref}
      type="button"
      className={classNames.join(' ')}
      onClick={onClick}
      aria-label={`截止日:${label}`}
    >
      <CalendarIcon />
      {/* 日期加近期的相對說法(同中欄);要看月曆就開彈窗 */}
      {(value !== null || showEmpty) && label}
    </button>
  )
}
