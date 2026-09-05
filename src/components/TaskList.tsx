'use client'

import { useCallback, useEffect, useState } from 'react'
import NewTaskForm from './NewTaskForm'
import TaskItem from './TaskItem'
import styles from './TaskList.module.css'

// 前端不 import src/server/,型別在這裡自行宣告;只列畫面用得到的欄位
export type Task = {
  id: number
  title: string
  dueDate: string | null
  priority: number
  completedAt: number | null
}

export type NewTask = {
  title: string
  dueDate: string | null
  priority: number
}

export type PriorityLevel = { label: string; tone: 'low' | 'medium' | 'high' }

// priority 的整數值 → 標籤與樣式 token,同一張表;
// tone 對應 TaskItem.module.css 的 class 名,色碼在 globals.css 的 :root。
const PRIORITY_LEVELS: Record<number, PriorityLevel | undefined> = {
  1: { label: '低', tone: 'low' },
  3: { label: '中', tone: 'medium' },
  5: { label: '高', tone: 'high' },
}

// 0(與 null)查不到 = 無優先級,不標示
export function priorityLevel(priority: number | null): PriorityLevel | undefined {
  return priority === null ? undefined : PRIORITY_LEVELS[priority]
}

// 表單多一個「無」,其餘從同一張表長出來,標籤不重打第二次
export const PRIORITY_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: '無' },
  ...Object.entries(PRIORITY_LEVELS).flatMap(([value, level]) =>
    level === undefined ? [] : [{ value: Number(value), label: level.label }],
  ),
]

// API 的錯誤一律是 { error: { code, message, fields? } }
async function readErrorMessage(response: Response): Promise<string> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    return '請求失敗'
  }

  const error = (body as { error?: { message?: string; fields?: Record<string, string> } })?.error
  if (!error?.message) {
    return '請求失敗'
  }
  if (!error.fields) {
    return error.message
  }

  const detail = Object.entries(error.fields)
    .map(([field, reason]) => `${field}: ${reason}`)
    .join(', ')
  return `${error.message}(${detail})`
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : '請求失敗'
}

export default function TaskList() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // 寫入 + 重抓的空窗期,用來擋連點
  const [mutating, setMutating] = useState(false)

  const refetch = useCallback(async () => {
    const response = await fetch('/api/tasks')
    if (!response.ok) {
      throw new Error(await readErrorMessage(response))
    }
    setTasks((await response.json()) as Task[])
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        await refetch()
        setError(null)
      } catch (caught) {
        setError(toMessage(caught))
      } finally {
        setLoading(false)
      }
    })()
  }, [refetch])

  // 寫入成功後整份重抓,不拿回應的物件更新 state,也不做樂觀更新
  const mutate = useCallback(
    async (request: () => Promise<Response>): Promise<boolean> => {
      setMutating(true)
      try {
        const response = await request()
        if (!response.ok) {
          throw new Error(await readErrorMessage(response))
        }
        await refetch()
        setError(null)
        return true
      } catch (caught) {
        setError(toMessage(caught))
        return false
      } finally {
        setMutating(false)
      }
    },
    [refetch],
  )

  const handleCreate = useCallback(
    (input: NewTask) =>
      mutate(() =>
        fetch('/api/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }),
      ),
    [mutate],
  )

  // 完成狀態只由 completedAt 表示,沒有布林欄位
  const handleToggle = useCallback(
    (task: Task) =>
      mutate(() =>
        fetch(`/api/tasks/${task.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            completedAt: task.completedAt === null ? Math.floor(Date.now() / 1000) : null,
          }),
        }),
      ),
    [mutate],
  )

  // 硬刪除,沒有 undo;失敗訊息走 mutate() 同一條路徑
  const handleDelete = useCallback(
    (id: number) => mutate(() => fetch(`/api/tasks/${id}`, { method: 'DELETE' })),
    [mutate],
  )

  return (
    <div className={styles.container}>
      <NewTaskForm onCreate={handleCreate} disabled={mutating} />

      {error !== null && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {loading && <p className={styles.status}>載入中…</p>}

      {!loading && error === null && tasks.length === 0 && (
        <p className={styles.status}>還沒有任務</p>
      )}

      {tasks.length > 0 && (
        <ul className={styles.list}>
          {tasks.map((task) => (
            <TaskItem
              key={task.id}
              task={task}
              onToggle={handleToggle}
              onDelete={handleDelete}
              disabled={mutating}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
