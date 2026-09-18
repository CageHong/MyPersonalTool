import { useRef, useState } from 'react'
import RecurrenceDialog from './RecurrenceDialog'
import type { ApiError } from '@/lib/errors'
import type { RecurrenceSpec } from '@/lib/recurrence'
import styles from './RecurrenceMenu.module.css'

type Props = {
  // 規則的錨點:任務的截止日,沒有就是今天
  anchor: string
  onSubmit: (spec: RecurrenceSpec) => Promise<ApiError | null>
}

// 結構同 DueDateMenu:觸發鈕 + 只在開啟時掛載的對話框
export default function RecurrenceMenu({ anchor, onSubmit }: Props) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  // 寫入排隊期間觸發鈕還在,可以再開一次再送一次;不停用按鈕,用 ref 擋掉第二次送出。
  // 完成後一律重設:失敗時不重設的話,之後的送出會被永久忽略
  const pendingRef = useRef(false)

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        onClick={() => setOpen(true)}
        // 同截止日、優先級:觸發鈕帶欄位名與目前值
        aria-label="重複:不重複"
      >
        不重複
      </button>

      {open && (
        <RecurrenceDialog
          anchor={anchor}
          // 對話框已經 close(),背景不再 inert,觸發鈕才聚焦得到。先移焦點再送出:
          // 送出時記錄的焦點位置才會是右欄,任務因此離開視圖時才找得到遞補列
          onClose={(result) => {
            setOpen(false)
            triggerRef.current?.focus()
            if (result === null || pendingRef.current) {
              return
            }
            pendingRef.current = true
            void onSubmit(result.spec).finally(() => {
              pendingRef.current = false
            })
          }}
        />
      )}
    </>
  )
}
