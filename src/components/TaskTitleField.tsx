import { useDraft } from '@/lib/useDraft'
import type { ApiError } from '@/lib/errors'
import type { Task } from '@/lib/tasks'
import styles from './TaskTitleField.module.css'

type Props = {
  id: string
  task: Task
  onSave: (title: string) => Promise<ApiError | null>
  // 錯誤訊息畫在 TaskDetail 的欄位下方,這裡只負責標示輸入框與指過去
  errorId: string
  invalid: boolean
  onClearError: () => void
}

export default function TaskTitleField({
  id,
  task,
  onSave,
  errorId,
  invalid,
  onClearError,
}: Props) {
  const draft = useDraft(task.title, onSave)

  return (
    <input
      id={id}
      type="text"
      className={invalid ? `${styles.input} ${styles.invalid}` : styles.input}
      value={draft.value}
      onFocus={draft.onFocus}
      // 一改就把錯誤清掉,紅框與訊息不會賴在使用者正在修的欄位上
      onChange={(event) => {
        draft.onChange(event.target.value)
        onClearError()
      }}
      onBlur={draft.onBlur}
      // 沒有錯誤時這兩個屬性不輸出,不要指向不存在的元素
      aria-invalid={invalid || undefined}
      aria-describedby={invalid ? errorId : undefined}
    />
  )
}
