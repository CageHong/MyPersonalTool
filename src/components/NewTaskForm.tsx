import { useState, type FormEvent } from 'react'
import { PRIORITY_OPTIONS, type NewTask } from './TaskList'
import styles from './NewTaskForm.module.css'

type Props = {
  onCreate: (input: NewTask) => Promise<boolean>
  disabled: boolean
}

export default function NewTaskForm({ onCreate, disabled }: Props) {
  const [title, setTitle] = useState('')
  const [dueDate, setDueDate] = useState('')
  // 0 = 無優先級
  const [priority, setPriority] = useState(0)

  // title 必填的規則在 src/server/,這裡不擋,讓它走完 API;錯誤訊息由 TaskList 顯示
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const created = await onCreate({ title, dueDate: dueDate === '' ? null : dueDate, priority })
    if (created) {
      setTitle('')
      setDueDate('')
      setPriority(0)
    }
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="new-task-title">
          標題
        </label>
        <input
          id="new-task-title"
          className={styles.input}
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          disabled={disabled}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="new-task-due-date">
          截止日
        </label>
        {/* type="date" 的值就是 YYYY-MM-DD,不經過時間戳 */}
        <input
          id="new-task-due-date"
          className={styles.input}
          type="date"
          value={dueDate}
          onChange={(event) => setDueDate(event.target.value)}
          disabled={disabled}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="new-task-priority">
          優先級
        </label>
        {/* 值域固定 0 / 1 / 3 / 5,選項從 PRIORITY_OPTIONS 那張表長出來 */}
        <select
          id="new-task-priority"
          className={styles.select}
          value={priority}
          onChange={(event) => setPriority(Number(event.target.value))}
          disabled={disabled}
        >
          {PRIORITY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <button className={styles.submit} type="submit" disabled={disabled}>
        新增
      </button>
    </form>
  )
}
