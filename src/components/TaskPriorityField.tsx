import { PRIORITY_OPTIONS, priorityLevel, type Task } from '@/lib/tasks'
import type { ApiError } from '@/lib/errors'
import styles from './TaskPriorityField.module.css'

type Props = {
  labelId: string
  task: Task
  onSave: (priority: number) => Promise<ApiError | null>
  disabled: boolean
}

export default function TaskPriorityField({ labelId, task, onSave, disabled }: Props) {
  return (
    <div className={styles.group} role="radiogroup" aria-labelledby={labelId}>
      {PRIORITY_OPTIONS.map((option) => {
        // 顏色只是輔助,文字標籤才是區分方式;「無」查不到 tone,用次要色
        const tone = priorityLevel(option.value)?.tone
        const className = tone === undefined ? styles.option : `${styles.option} ${styles[tone]}`

        return (
          <label key={option.value} className={className}>
            {/* 點已經選中的那顆不會觸發 change,值相同就不會送 PATCH */}
            <input
              type="radio"
              className={styles.radio}
              name="task-priority"
              value={option.value}
              checked={option.value === task.priority}
              onChange={() => void onSave(option.value)}
              disabled={disabled}
            />
            {option.label}
          </label>
        )
      })}
    </div>
  )
}
