import { Calendar } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import DueDateDialog from './DueDateDialog'
import PriorityMenu from './PriorityMenu'
import { formatRelativeDate } from '@/lib/date'
import type { NewTask } from '@/lib/tasks'
import styles from './NewTaskForm.module.css'

type Props = {
  onCreate: (input: NewTask) => Promise<boolean>
  disabled: boolean
}

// 整列是一個草稿單位,送出成功後一次清掉;形狀就是 POST 要送的那三個欄位
const EMPTY: NewTask = { title: '', dueDate: null, priority: 0 }

export default function NewTaskForm({ onCreate, disabled }: Props) {
  const [draft, setDraft] = useState<NewTask>(EMPTY)
  const [dateOpen, setDateOpen] = useState(false)

  // title 必填的規則在 src/server/,這裡不擋,讓它走完 API;
  // 下面那行擋的是空白輸入框按 Enter 這種誤觸——正確反應是什麼都不發生,
  // 不是判斷標題合法與否。錯誤訊息仍由 TaskList 顯示。
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (draft.title.trim() === '') {
      return
    }

    const created = await onCreate(draft)
    if (created) {
      setDraft(EMPTY)
    }
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      {/* 單列版面沒有可見標籤的位置,改用 aria-label */}
      <input
        className={styles.input}
        type="text"
        value={draft.title}
        onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
        disabled={disabled}
        aria-label="標題"
        placeholder="新增任務"
      />

      {/* 日期是草稿,按確定只寫回 draft,不送 PATCH */}
      <button
        type="button"
        className={draft.dueDate === null ? styles.trigger : `${styles.trigger} ${styles.triggerSet}`}
        onClick={() => setDateOpen(true)}
        disabled={disabled}
        aria-label={`截止日:${draft.dueDate === null ? '未設定' : draft.dueDate}`}
      >
        <Calendar size={16} aria-hidden />
        {draft.dueDate !== null && formatRelativeDate(draft.dueDate)}
      </button>

      {dateOpen && (
        <DueDateDialog
          dueDate={draft.dueDate}
          onClose={() => setDateOpen(false)}
          onConfirm={(dueDate) => {
            setDraft((current) => ({ ...current, dueDate }))
            setDateOpen(false)
          }}
        />
      )}

      <PriorityMenu
        value={draft.priority}
        onSelect={(priority) => setDraft((current) => ({ ...current, priority }))}
        disabled={disabled}
      />

      <button className={styles.submit} type="submit" disabled={disabled}>
        新增
      </button>
    </form>
  )
}
