import { useDraft } from '@/modules/tasks/lib/useDraft'
import type { ApiError } from '@/modules/tasks/lib/errors'
import type { Task } from '@/modules/tasks/lib/tasks'
import styles from './TaskNotesField.module.css'

type Props = {
  id: string
  task: Task
  onSave: (notes: string | null) => Promise<ApiError | null>
  // 目前沒有描述的驗證規則,結構仍和標題一致,之後加規則不必再改形狀
  errorId: string
  invalid: boolean
  onClearError: () => void
}

export default function TaskNotesField({
  id,
  task,
  onSave,
  errorId,
  invalid,
  onClearError,
}: Props) {
  // 畫面上 null 就是空字串;清空是合法的,存回去要變成 null
  const draft = useDraft(task.notes ?? '', (value) => onSave(value === '' ? null : value))

  return (
    <textarea
      id={id}
      className={invalid ? `${styles.textarea} ${styles.invalid}` : styles.textarea}
      rows={6}
      value={draft.value}
      onFocus={draft.onFocus}
      onChange={(event) => {
        draft.onChange(event.target.value)
        onClearError()
      }}
      onBlur={draft.onBlur}
      aria-invalid={invalid || undefined}
      aria-describedby={invalid ? errorId : undefined}
    />
  )
}
