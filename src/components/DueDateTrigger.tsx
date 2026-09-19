import type { Ref } from 'react'
import CalendarIcon from './CalendarIcon'
import { formatRelativeDate, isOverdue } from '@/lib/date'
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

  const label = value === null ? '無' : formatRelativeDate(value)

  return (
    <button
      ref={ref}
      type="button"
      className={classNames.join(' ')}
      onClick={onClick}
      aria-label={`截止日:${label}`}
    >
      <CalendarIcon />
      {/* 相對描述;要看真正的日曆就開彈窗 */}
      {(value !== null || showEmpty) && label}
    </button>
  )
}
