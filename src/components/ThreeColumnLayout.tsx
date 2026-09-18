'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import CategoryColumn from './CategoryColumn'
import TaskDetail from './TaskDetail'
import TaskList from './TaskList'
import styles from './ThreeColumnLayout.module.css'
import { todayIso } from '@/lib/date'
import { generalMessage, NETWORK_ERROR, readApiError, type ApiError } from '@/lib/errors'
import { filterTasks, parseView, type ViewId } from '@/lib/views'
import type { NewTask, Task, TaskPatch } from '@/lib/tasks'

// 泛用錯誤才有整段訊息可顯示;欄位錯誤由出錯的欄位自己畫在下面
function toGeneralMessage(failure: ApiError): string | null {
  return failure.kind === 'general' ? generalMessage(failure.code) : null
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

  // 刪除成功後焦點要移到遞補上來的那一列。存「被刪的任務」而不是布林值:
  // 確認彈窗在請求進行中可以取消,使用者可能先選了別的任務,布林值會停在 true,
  // 之後任何一次 selectedTask 變成 undefined 都會誤移焦點。不影響畫面,所以用 ref 不用 state。
  // 記索引不記「下一筆的 id」:之後加排序或篩選時,同一個索引仍然對應刪除後的同一個位置
  const tasksColumnRef = useRef<HTMLElement>(null)
  const rowTitleRefs = useRef<(HTMLButtonElement | null)[]>([])
  const focusAfterDeleteRef = useRef<{ id: number; index: number } | null>(null)

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

  // 回傳 null 代表成功;失敗的形狀和寫入共用同一個 ApiError
  const refetch = useCallback(async (): Promise<ApiError | null> => {
    const response = await fetch('/api/tasks')
    if (!response.ok) {
      return await readApiError(response)
    }
    setTasks((await response.json()) as Task[])
    return null
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const failure = await refetch()
        setError(failure === null ? null : toGeneralMessage(failure))
      } catch {
        // fetch 直接 reject:網路中斷、伺服器沒起來
        setError(generalMessage('NETWORK'))
      } finally {
        setLoading(false)
      }
    })()
  }, [refetch])

  // 網址指到看不到的任務(被刪掉、手打的 id、被檢視濾掉)就把參數清掉,右欄回空狀態。
  // 要等 loading 結束才判斷,否則首次載入時 tasks 還是空的,合法的 ?task= 會被誤刪。
  // 從右欄刪除時由 handleDelete 在成功後直接清,不靠這個 effect;兩邊都清也是同一個結果。
  useEffect(() => {
    if (loading || selectedId === null || selectedTask !== undefined) {
      return
    }
    replaceParams((params) => params.delete('task'))
  }, [loading, replaceParams, selectedId, selectedTask])

  // 列數變少時裁掉陣列尾巴,不留已經卸載的元素。陣列是這一層的 ref,裁切也放這一層:
  // 在 TaskList 裡改會動到 prop,react-hooks/immutability 不允許
  useEffect(() => {
    rowTitleRefs.current.length = visibleTasks.length
  }, [visibleTasks])

  // 被刪的任務從 tasks 消失 = 重抓已經套用到畫面。這次渲染裡右欄已換成空狀態,
  // ConfirmDialog 連同 <dialog> 一起卸載,彈窗外的 inert 已解除,focus() 才有效。
  // 不在 handleDelete 的 await 之後直接 focus:那時重抓的渲染不一定已經套用。
  // 右欄仍有選取(請求中取消彈窗、改選別的任務)就不搶焦點;兩種情況都清掉旗標。
  //
  // rowTitleRefs 讀得到新清單,是因為 callback ref 在 commit 階段就接好了,早於所有 effect。
  // 尾巴的殘留由上面那個 effect 裁掉,它宣告在前面所以先執行;搬動順序前先確認這兩件事還成立
  useEffect(() => {
    const pending = focusAfterDeleteRef.current
    if (pending === null || tasks.some((task) => task.id === pending.id)) {
      return
    }
    focusAfterDeleteRef.current = null
    if (selectedTask !== undefined) {
      return
    }

    // 刪的是最後一筆就退到前一筆;清單空了或元素不在就退到中欄容器
    const rows = visibleTasks.length
    const target = rows === 0 ? null : rowTitleRefs.current[Math.min(pending.index, rows - 1)]
    if (target != null && target.isConnected) {
      target.focus()
    } else {
      tasksColumnRef.current?.focus()
    }
  }, [tasks, selectedTask, visibleTasks])

  // 寫入成功後整份重抓,不拿回應的物件更新 state,也不做樂觀更新。
  // 回傳 null 代表成功;欄位錯誤原樣回傳給呼叫端,不進中欄的錯誤區
  const mutate = useCallback(
    async (request: () => Promise<Response>): Promise<ApiError | null> => {
      setMutating(true)
      try {
        const response = await request()
        if (!response.ok) {
          const failure = await readApiError(response)
          setError(toGeneralMessage(failure))
          return failure
        }

        const refetchFailure = await refetch()
        setError(refetchFailure === null ? null : toGeneralMessage(refetchFailure))
        return refetchFailure
      } catch {
        setError(generalMessage('NETWORK'))
        return NETWORK_ERROR
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

  // 硬刪除,沒有 undo。刪除鈕在右欄,刪的一定是選取中那筆:成功後清掉 task、保留 view;
  // 失敗時 mutate 已經 setError,任務、選取與焦點都不動
  const handleDelete = useCallback(
    async (id: number) => {
      // 送出前就設好:重抓的渲染可能比 await 回來更早套用,effect 要在那時看得到旗標。
      // 索引是刪除前的畫面順序,刪除後同一個索引就是遞補上來的那一筆
      focusAfterDeleteRef.current = {
        id,
        index: visibleTasks.findIndex((task) => task.id === id),
      }
      const failure = await mutate(() => fetch(`/api/tasks/${id}`, { method: 'DELETE' }))
      if (failure === null) {
        replaceParams((params) => params.delete('task'))
      } else {
        focusAfterDeleteRef.current = null
      }
      return failure
    },
    [mutate, replaceParams, visibleTasks],
  )

  return (
    <div className={styles.layout}>
      <section className={`${styles.column} ${styles.categories}`}>
        <CategoryColumn view={view} onSelect={handleSelectView} today={today} />
      </section>

      {/* tabIndex={-1}:不進 Tab 順序,只讓程式在刪除後把焦點放過來 */}
      <section
        ref={tasksColumnRef}
        tabIndex={-1}
        aria-label="任務清單"
        className={`${styles.column} ${styles.tasks}`}
      >
        <TaskList
          tasks={visibleTasks}
          loading={loading}
          error={error}
          mutating={mutating}
          selectedId={selectedId}
          onSelect={handleSelect}
          onCreate={handleCreate}
          onToggle={handleToggle}
          titleRefs={rowTitleRefs}
        />
      </section>

      <section className={`${styles.column} ${styles.detail}`}>
        {/* key 換掉 = 換任務就重新掛載:欄位錯誤與確認彈窗的狀態自動回到初始值,
            不必用 effect 偵測 task.id 變化 */}
        <TaskDetail
          key={selectedTask?.id ?? 'empty'}
          task={selectedTask}
          mutating={mutating}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
        />
      </section>
    </div>
  )
}
