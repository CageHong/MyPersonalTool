import { useEffect, useRef, useState } from 'react'
import MonthCalendar from './MonthCalendar'
import { addDays, nextWeekday, onOrNextWeekday, todayIso } from '@/lib/date'
import type { DueDateDraft } from '@/lib/tasks'
import styles from './DueDateDialog.module.css'

type Props = {
  dueDate: string | null
  onConfirm: (dueDate: string | null) => void
  onClose: () => void
}

export default function DueDateDialog({ dueDate, onConfirm, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  // 這個彈窗之後還要放時間與重複規則,草稿一開始就是物件,到時候往裡面加 key。
  // 還沒有截止日時草稿預設今天,月曆一開就停在今天那格;實際值不變,仍然要按確定才寫入。
  // 兩個呼叫端都是開啟時才掛載,所以初始值每次開啟都會重算
  const [draft, setDraft] = useState<DueDateDraft>({ dueDate: dueDate ?? todayIso() })

  // showModal() 才有 Esc 關閉、焦點鎖在彈窗內、背景 inert、關閉後焦點回到觸發按鈕。
  // 開發模式下 effect 會跑兩次,先確認還沒開啟。
  // 焦點明確放在 <dialog> 本身,按一次 Tab 才進到第一個按鈕。不用 React 的 autoFocus:
  // 它在掛載時就 focus(),那時 dialog 還沒 showModal() 不可聚焦,
  // 接著 showModal() 又會自己把焦點給第一個可聚焦的子元素
  useEffect(() => {
    const dialog = ref.current
    if (dialog === null) {
      return
    }
    if (!dialog.open) {
      dialog.showModal()
    }
    dialog.focus()
  }, [])

  const today = todayIso()
  const shortcuts = [
    { label: '今天', value: today },
    { label: '明天', value: addDays(today, 1) },
    // 最近的週六;今天就是週六的話就是今天
    { label: '本週末', value: onOrNextWeekday(today, 6) },
    // 下一個週一
    { label: '下週', value: nextWeekday(today, 1) },
  ]

  return (
    <dialog
      ref={ref}
      tabIndex={-1}
      className={styles.dialog}
      onClose={onClose}
      // dialog 自己沒有內距,點到它本身就是點到 backdrop
      onClick={(event) => {
        if (event.target === ref.current) {
          onClose()
        }
      }}
    >
      <div className={styles.content}>
        <div className={styles.shortcuts}>
          {shortcuts.map((shortcut) => (
            <button
              key={shortcut.label}
              type="button"
              className={styles.shortcut}
              // 快捷鍵只改草稿,一樣要按確定才送出
              onClick={() => setDraft((current) => ({ ...current, dueDate: shortcut.value }))}
            >
              {shortcut.label}
            </button>
          ))}
        </div>

        <MonthCalendar
          value={draft.dueDate}
          onSelect={(iso) => setDraft((current) => ({ ...current, dueDate: iso }))}
        />

        <div className={styles.footer}>
          {/* 清除 = 設成 null 並送出 */}
          <button type="button" className={styles.clear} onClick={() => onConfirm(null)}>
            清除
          </button>
          <button
            type="button"
            className={styles.confirm}
            onClick={() => onConfirm(draft.dueDate)}
          >
            確定
          </button>
        </div>
      </div>
    </dialog>
  )
}
