import { useRef, useState, type FormEvent } from 'react'
import type { ApiError } from '@/modules/tasks/lib/errors'
import styles from './NewHabitForm.module.css'

type Props = {
  // 用預設的每天 1 次建立;頻率與目標到右欄再改。錯誤走泛用路徑,顯示在新增列正下方
  onCreate: (name: string) => Promise<ApiError | null>
}

// 形式同任務的新增列(NewTaskForm):Enter 送出、成功才清空、不停用輸入框,可以連續新增
export default function NewHabitForm({ onCreate }: Props) {
  const [name, setName] = useState('')
  // 自己送出的請求還沒回來時擋掉第二次送出;不停用也不設 readOnly(同 NewTaskForm)
  const pendingRef = useRef(false)

  // 名稱必填的規則在 src/modules/tasks/server/;這裡擋的是空白輸入框按 Enter 的誤觸,反應是什麼都不發生
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pendingRef.current || name.trim() === '') {
      return
    }

    const submitted = name
    pendingRef.current = true
    const failure = await onCreate(submitted)
    pendingRef.current = false

    if (failure === null) {
      // 等待期間使用者已經開始打下一筆的話,不要清掉
      setName((current) => (current === submitted ? '' : current))
    }
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <input
        className={styles.input}
        type="text"
        value={name}
        onChange={(event) => setName(event.target.value)}
        aria-label="名稱"
        placeholder="新增習慣"
      />
      <button className={styles.submit} type="submit">
        新增
      </button>
    </form>
  )
}
