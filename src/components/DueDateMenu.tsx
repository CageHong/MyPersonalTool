import { useRef, useState } from 'react'
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
  const triggerRef = useRef<HTMLButtonElement>(null)

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
        ref={triggerRef}
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
          // 對話框已經 close(),背景不再 inert,觸發鈕才聚焦得到。先移焦點再存:
          // 存檔會讓右欄進入 mutating,之後觸發鈕可能被停用(C3b-2c 處理)
          onClose={(result) => {
            setOpen(false)
            triggerRef.current?.focus()
            // 內容沒變不送請求(同 checklist 的標題)
            if (result !== null && result.dueDate !== value) {
              onSelect(result.dueDate)
            }
          }}
        />
      )}
    </>
  )
}
