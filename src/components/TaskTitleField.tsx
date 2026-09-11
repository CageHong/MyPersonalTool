import { useDraft } from '@/lib/useDraft'
import type { Task } from '@/lib/tasks'
import styles from './TaskTitleField.module.css'

type Props = {
  id: string
  task: Task
  onSave: (title: string) => Promise<boolean>
  disabled: boolean
}

export default function TaskTitleField({ id, task, onSave, disabled }: Props) {
  const draft = useDraft(task.title, onSave)

  return (
    <input
      id={id}
      type="text"
      className={styles.input}
      value={draft.value}
      onFocus={draft.onFocus}
      onChange={(event) => draft.onChange(event.target.value)}
      onBlur={draft.onBlur}
      disabled={disabled}
    />
  )
}
