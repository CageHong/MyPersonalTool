import { useRef, useState, type FormEvent } from 'react'
import DueDateMenu from './DueDateMenu'
import PriorityMenu from './PriorityMenu'
import type { ApiError } from '@/lib/errors'
import type { NewTask } from '@/lib/tasks'
import styles from './NewTaskForm.module.css'

type Props = {
  // 新增列的錯誤走泛用路徑,顯示在中欄新增列正下方,不做欄位標示
  onCreate: (input: NewTask) => Promise<ApiError | null>
}

// 整列是一個草稿單位,送出成功後一次清掉;形狀就是 POST 要送的那三個欄位
const EMPTY: NewTask = { title: '', dueDate: null, priority: 0 }

export default function NewTaskForm({ onCreate }: Props) {
  const [draft, setDraft] = useState<NewTask>(EMPTY)
  // 自己送出的請求還沒回來時擋掉第二次送出(同 NewChecklistItemForm)。
  // 不停用也不設 readOnly:使用者可以接著打下一筆。
  // 同一段文字連按兩次 Enter:第二次在這裡直接 return;請求回來時輸入框還是那段字就清空,
  // 所以只會建立一筆。失敗時字留著、旗標已放開,再按 Enter 就是重試
  const pendingRef = useRef(false)

  // title 必填的規則在 src/server/,這裡不擋,讓它走完 API;
  // 下面那行擋的是空白輸入框按 Enter 這種誤觸——正確反應是什麼都不發生,
  // 不是判斷標題合法與否。錯誤訊息仍由 TaskList 顯示。
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pendingRef.current || draft.title.trim() === '') {
      return
    }

    const submitted = draft
    pendingRef.current = true
    const failure = await onCreate(submitted)
    pendingRef.current = false

    if (failure === null) {
      // 只清掉和送出時相同的欄位:等待期間使用者改過的東西都留著
      setDraft((current) => ({
        title: current.title === submitted.title ? EMPTY.title : current.title,
        dueDate: current.dueDate === submitted.dueDate ? EMPTY.dueDate : current.dueDate,
        priority: current.priority === submitted.priority ? EMPTY.priority : current.priority,
      }))
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
        aria-label="標題"
        placeholder="新增任務"
      />

      {/* 日期與優先級都是草稿,只寫回 draft,不送 PATCH */}
      <DueDateMenu
        value={draft.dueDate}
        onSelect={(dueDate) => setDraft((current) => ({ ...current, dueDate }))}
        showEmpty={false}
      />

      <PriorityMenu
        value={draft.priority}
        onSelect={(priority) => setDraft((current) => ({ ...current, priority }))}
        showValue={false}
      />

      <button className={styles.submit} type="submit">
        新增
      </button>
    </form>
  )
}
