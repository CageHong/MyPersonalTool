'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import TaskDetail from './TaskDetail'
import TaskList from './TaskList'
import styles from './ThreeColumnLayout.module.css'
import type { NewTask, Task } from '@/lib/tasks'

// 分類欄這一輪還是佔位;view 參數之後才做
const VIEW_PLACEHOLDERS = ['今天', '未來 7 天', '全部未完成', '已完成']

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

// 網址上的值是使用者可以亂打的字串;不是正整數就當作沒選取
function parseTaskId(raw: string | null): number | null {
  if (raw === null) {
    return null
  }
  const id = Number(raw)
  return Number.isInteger(id) && id > 0 ? id : null
}

export default function ThreeColumnLayout() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // 寫入 + 重抓的空窗期,用來擋連點
  const [mutating, setMutating] = useState(false)

  const selectedId = parseTaskId(searchParams.get('task'))
  const selectedTask = tasks.find((task) => task.id === selectedId)

  // 選取狀態只存在網址裡,不放元件 state;複製既有參數,之後加的 view 才不會被洗掉
  const replaceParams = useCallback(
    (mutateParams: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams)
      mutateParams(params)
      const query = params.toString()
      router.replace(query === '' ? pathname : `${pathname}?${query}`, { scroll: false })
    },
    [pathname, router, searchParams],
  )

  const handleSelect = useCallback(
    (id: number) => replaceParams((params) => params.set('task', String(id))),
    [replaceParams],
  )

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

  // 網址指到不存在的任務(例如剛被刪掉,或手打的 id)就把參數清掉,右欄回空狀態。
  // 要等 loading 結束才判斷,否則首次載入時 tasks 還是空的,合法的 ?task= 會被誤刪。
  useEffect(() => {
    if (loading || selectedId === null || selectedTask !== undefined) {
      return
    }
    replaceParams((params) => params.delete('task'))
  }, [loading, replaceParams, selectedId, selectedTask])

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

  // 硬刪除,沒有 undo;刪掉的若是選取中那筆,由上面的 effect 清掉網址參數
  const handleDelete = useCallback(
    (id: number) => mutate(() => fetch(`/api/tasks/${id}`, { method: 'DELETE' })),
    [mutate],
  )

  return (
    <div className={styles.layout}>
      <section className={`${styles.column} ${styles.categories}`}>
        <h2 className={styles.columnTitle}>分類</h2>
        <div className={styles.placeholder}>
          {VIEW_PLACEHOLDERS.map((view) => (
            <span key={view}>{view}</span>
          ))}
        </div>
      </section>

      <section className={`${styles.column} ${styles.tasks}`}>
        <TaskList
          tasks={tasks}
          loading={loading}
          error={error}
          mutating={mutating}
          selectedId={selectedId}
          onSelect={handleSelect}
          onCreate={handleCreate}
          onToggle={handleToggle}
          onDelete={handleDelete}
        />
      </section>

      <section className={`${styles.column} ${styles.detail}`}>
        <TaskDetail task={selectedTask} />
      </section>
    </div>
  )
}
