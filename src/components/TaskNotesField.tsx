import { useDraft } from '@/lib/useDraft'
import type { Task } from '@/lib/tasks'
import styles from './TaskNotesField.module.css'

type Props = {
  id: string
  task: Task
  onSave: (notes: string | null) => Promise<boolean>
  disabled: boolean
}

export default function TaskNotesField({ id, task, onSave, disabled }: Props) {
  // 畫面上 null 就是空字串;清空是合法的,存回去要變成 null
  const draft = useDraft(task.notes ?? '', (value) => onSave(value === '' ? null : value))

  return (
    <textarea
      id={id}
      className={styles.textarea}
      rows={6}
      value={draft.value}
      onFocus={draft.onFocus}
      onChange={(event) => draft.onChange(event.target.value)}
      onBlur={draft.onBlur}
      disabled={disabled}
    />
  )
}
