import { useRef, useState } from 'react'
import DueDateDialog from './DueDateDialog'
import DueDateTrigger from './DueDateTrigger'

// 只吃日期字串,不認得 task。目前只有新增列用:任務還不存在,沒有重複設定。
// 右欄的截止日由 TaskDetail 自己組(同一個觸發鈕與對話框,加上重複設定)
type Props = {
  value: string | null
  // 月曆彈窗按確定才呼叫;選好按確定才存是截止日的儲存時機
  onSelect: (dueDate: string | null) => void
  showEmpty: boolean
}

export default function DueDateMenu({ value, onSelect, showEmpty }: Props) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  return (
    <>
      <DueDateTrigger
        ref={triggerRef}
        value={value}
        showEmpty={showEmpty}
        onClick={() => setOpen(true)}
      />

      {/* 只在開啟時掛載:關閉即卸載,草稿跟著消失 */}
      {open && (
        <DueDateDialog
          dueDate={value}
          // 對話框已經 close(),背景不再 inert,觸發鈕才聚焦得到。先移焦點再存:
          // 儲存時記錄的焦點位置才會是觸發鈕,任務因此離開視圖時才找得到遞補列
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
