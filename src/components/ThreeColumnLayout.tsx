'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import CategoryColumn from './CategoryColumn'
import TaskDetail from './TaskDetail'
import TaskList from './TaskList'
import styles from './ThreeColumnLayout.module.css'
import { todayIso } from '@/lib/date'
import { filterTasks, parseView, type ViewId } from '@/lib/views'
import type { NewTask, Task, TaskPatch } from '@/lib/tasks'

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

  const today = todayIso()
  const view = parseView(searchParams.get('view'))
  // 篩選在前端做,GET /api/tasks 照舊拿全部
  const visibleTasks = filterTasks(tasks, view, today)

  const selectedId = parseTaskId(searchParams.get('task'))
  // 從看得到的那些裡面找:選取的任務被檢視濾掉時,下面的 effect 會清掉 task 參數
  const selectedTask = visibleTasks.find((task) => task.id === selectedId)

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

  const handleSelectView = useCallback(
    (next: ViewId) => replaceParams((params) => params.set('view', next)),
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

  // 網址指到看不到的任務(被刪掉、手打的 id、被檢視濾掉)就把參數清掉,右欄回空狀態。
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

  // 右欄的欄位各自送一次 PATCH,body 只含那個欄位
  const handleUpdate = useCallback(
    (id: number, patch: TaskPatch) =>
      mutate(() =>
        fetch(`/api/tasks/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
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
        <CategoryColumn view={view} onSelect={handleSelectView} today={today} />
      </section>

      <section className={`${styles.column} ${styles.tasks}`}>
        <TaskList
          tasks={visibleTasks}
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
        <TaskDetail task={selectedTask} mutating={mutating} onUpdate={handleUpdate} />
      </section>
    </div>
  )
}
