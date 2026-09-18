import { useState } from 'react'
import CalendarIcon from './CalendarIcon'
import DueDateDialog from './DueDateDialog'
import { formatRelativeDate, isOverdue } from '@/lib/date'
import styles from './DueDateMenu.module.css'

// 只吃日期字串,不認得 task;和 PriorityMenu 對稱,新增列與右欄共用
type Props = {
  value: string | null
  // 月曆彈窗按確定才呼叫;選好按確定才存是截止日的儲存時機
  onSelect: (dueDate: string | null) => void
  disabled: boolean
  // 右欄要讀得出目前狀態,空值顯示淡色「無」;新增列空值是預設,只放圖示
  showEmpty: boolean
}

export default function DueDateMenu({ value, onSelect, disabled, showEmpty }: Props) {
  const [open, setOpen] = useState(false)

  const classNames = [styles.trigger]
  if (value === null) {
    classNames.push(styles.empty)
  } else if (isOverdue(value)) {
    classNames.push(styles.overdue)
  }

  const label = value === null ? '無' : formatRelativeDate(value)

  return (
    <>
      <button
        type="button"
        className={classNames.join(' ')}
        onClick={() => setOpen(true)}
        disabled={disabled}
        aria-label={`截止日:${label}`}
      >
        <CalendarIcon />
        {/* 相對描述;要看真正的日曆就開彈窗 */}
        {(value !== null || showEmpty) && label}
      </button>

      {/* 只在開啟時掛載:關閉即卸載,草稿跟著消失 */}
      {open && (
        <DueDateDialog
          dueDate={value}
          onClose={() => setOpen(false)}
          onConfirm={(dueDate) => {
            setOpen(false)
            onSelect(dueDate)
          }}
        />
      )}
    </>
  )
}
