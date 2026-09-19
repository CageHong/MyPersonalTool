'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import CategoryColumn from './CategoryColumn'
import TaskDetail from './TaskDetail'
import TaskList from './TaskList'
import styles from './ThreeColumnLayout.module.css'
import { todayIso } from '@/lib/date'
import { generalMessage, NETWORK_ERROR, readApiError, type ApiError } from '@/lib/errors'
import type { RecurrenceRequest } from '@/lib/recurrenceDraft'
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

// 規則的三個端點:新建、修改、停止
function recurrenceRequest(taskId: number, request: RecurrenceRequest): Promise<Response> {
  switch (request.kind) {
    case 'create':
      return fetch(`/api/tasks/${taskId}/recurrence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request.spec),
      })
    case 'update':
      return fetch(`/api/recurrence-rules/${request.ruleId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request.changes),
      })
    case 'stop':
      return fetch(`/api/recurrence-rules/${request.ruleId}/stop`, { method: 'POST' })
  }
}

// 寫入時焦點所在的任務。control:焦點在中欄勾選框、中欄的列(勾選框以外),或右欄(含確認彈窗)
type FocusSnapshot = { id: number; index: number; control: 'checkbox' | 'row' | 'detail' }

// 中欄目前畫出來的列,依畫面順序;DOM 就是「目前視圖的清單」,不必另外重算篩選
function taskRows(column: HTMLElement): HTMLElement[] {
  return Array.from(column.querySelectorAll<HTMLElement>('li[data-task-id]'))
}

// 任務列(li)與右欄(article)都標了 data-task-id;焦點不在任何任務底下就不記
function captureFocus(column: HTMLElement | null): FocusSnapshot | null {
  const active = document.activeElement
  if (column === null || !(active instanceof HTMLElement)) {
    return null
  }
  const owner = active.closest<HTMLElement>('[data-task-id]')
  if (owner === null) {
    return null
  }
  const id = Number(owner.dataset.taskId)
  const index = taskRows(column).findIndex((row) => row.dataset.taskId === String(id))
  if (index === -1) {
    return null
  }
  let control: FocusSnapshot['control'] = 'detail'
  if (column.contains(active)) {
    control = active.closest('[data-task-control="checkbox"]') === null ? 'row' : 'checkbox'
  }
  return { id, index, control }
}

// 任務從目前視圖消失(刪除、勾完成、改欄位被篩掉)時,焦點移到遞補上來的那一列:
// 下一列,沒有就上一列;清單空了落中欄容器。原本在勾選框就落到遞補列的勾選框,鍵盤可以連續勾。
// 只在焦點已經掉到 body 時才動:排隊期間使用者把焦點移到別處的話不搶(同 TaskChecklist)。
// 記索引不記「下一筆的 id」:同一個索引就是消失後遞補到同一個位置的那一筆
function restoreFocus(column: HTMLElement, snapshot: FocusSnapshot) {
  const rows = taskRows(column)
  if (rows.some((row) => row.dataset.taskId === String(snapshot.id))) {
    return
  }
  const active = document.activeElement
  if (active !== null && active !== document.body) {
    return
  }
  if (rows.length === 0) {
    column.focus()
    return
  }
  const row = rows[Math.min(snapshot.index, rows.length - 1)]
  const control = snapshot.control === 'checkbox' ? 'checkbox' : 'row'
  const target = row.querySelector<HTMLElement>(`[data-task-control="${control}"]`)
  ;(target ?? column).focus()
}

export default function ThreeColumnLayout() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [tasks, setTasks] = useState<Task[]>([])
  // 每次重抓任務清單就加一。右欄的規則跟著它重抓:停止、修改規則時任務本身的欄位不變,
  // 只靠 tasks 的內容看不出規則變了
  const [tasksVersion, setTasksVersion] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // 寫入排隊:每個動作等前一個(含重抓)結束才開始,所以不必停用任何控制項。
  // 有焦點的元素被停用時瀏覽器會把焦點移到 body;停用也會吞掉寫入期間的點擊。
  // 例:標題編輯中直接點中欄勾選框,失焦觸發的儲存先排進去,勾選排在它後面,兩個都會執行
  const queueRef = useRef<Promise<unknown>>(Promise.resolve())
  // 任務消失後要把焦點放回來的容器(清單空了的落點);tabIndex={-1} 見下方
  const tasksColumnRef = useRef<HTMLElement>(null)

  const today = todayIso()
  const view = parseView(searchParams.get('view'))
  // 篩選在前端做,GET /api/tasks 照舊拿全部。重複實例每條規則只剩一個代表,
  // 非代表的實例不在 visibleTasks 裡,所以也選不到(網址上的 task 會被下面的 effect 清掉)
  const { tasks: visibleTasks, overdueCounts } = filterTasks(tasks, view, today)

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

  // 回傳 null 代表成功;失敗的形狀和寫入共用同一個 ApiError。
  // flushSync:回傳時新清單已經 commit 到 DOM,呼叫端接著就能依畫面上的列移焦點。
  // 這時右欄若已換成空狀態,確認彈窗連同 <dialog> 一起卸載、背景 inert 已解除,focus() 才有效
  const refetch = useCallback(async (): Promise<ApiError | null> => {
    const response = await fetch('/api/tasks')
    if (!response.ok) {
      return await readApiError(response)
    }
    const next = (await response.json()) as Task[]
    flushSync(() => {
      setTasks(next)
      setTasksVersion((version) => version + 1)
    })
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

  const enqueue = useCallback(<T,>(job: () => Promise<T>): Promise<T> => {
    const next = queueRef.current.then(job)
    // 佇列本身不能因為某個動作失敗就斷掉
    queueRef.current = next.catch(() => undefined)
    return next
  }, [])

  // 寫入成功後整份重抓,不拿回應的物件更新 state,也不做樂觀更新。
  // 回傳 null 代表成功;欄位錯誤原樣回傳給呼叫端,不進中欄的錯誤區
  // 多個請求時放進同一個佇列工作、依序送出:例如日期選單先改截止日、再改規則(規則的錨點是那個日期)。
  // 遇到第一個失敗就停,不拿被拒的日期去改規則;前面已經成功的仍然重抓一次,畫面要跟上伺服器
  const mutate = useCallback(
    (requests: (() => Promise<Response>) | (() => Promise<Response>)[]): Promise<ApiError | null> => {
      const list = Array.isArray(requests) ? requests : [requests]
      // 在呼叫當下(事件處理中)同步記錄焦點,不等 job 開始才讀:
      // 例如確認刪除時確認鈕進入 pending 而 disabled,那次提交早於 job,焦點已經掉到 body
      const focus = captureFocus(tasksColumnRef.current)
      return enqueue(async () => {
        try {
          for (const [index, request] of list.entries()) {
            const response = await request()
            if (!response.ok) {
              const failure = await readApiError(response)
              if (index > 0) {
                await refetch()
              }
              setError(toGeneralMessage(failure))
              return failure
            }
          }

          const refetchFailure = await refetch()
          setError(refetchFailure === null ? null : toGeneralMessage(refetchFailure))
          // 失敗時任務與焦點都不動
          if (refetchFailure === null && focus !== null && tasksColumnRef.current !== null) {
            restoreFocus(tasksColumnRef.current, focus)
          }
          return refetchFailure
        } catch {
          setError(generalMessage('NETWORK'))
          return NETWORK_ERROR
        }
      })
    },
    [enqueue, refetch],
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

  // 完成狀態只由 completedAt 表示,沒有布林欄位;
  // API 收 done,完成時間由伺服器寫入(重複送完成不會改寫原本的時間)
  const handleToggle = useCallback(
    (task: Task) =>
      mutate(() =>
        fetch(`/api/tasks/${task.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ done: task.completedAt === null }),
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

  // 日期選單按確定:截止日與重複規則。兩者都有改時先送日期、再送規則(規則的錨點是任務的日期),
  // 放在同一個佇列工作裡。undefined = 那一項沒有改。
  // 截止日可能因此改變、任務離開目前檢視,焦點照 mutate 的離開視圖規則處理
  const handleSaveDate = useCallback(
    (id: number, dueDate: string | null | undefined, recurrence: RecurrenceRequest | undefined) => {
      const requests: (() => Promise<Response>)[] = []
      if (dueDate !== undefined) {
        requests.push(() =>
          fetch(`/api/tasks/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dueDate }),
          }),
        )
      }
      if (recurrence !== undefined) {
        requests.push(() => recurrenceRequest(id, recurrence))
      }
      return requests.length === 0 ? Promise.resolve(null) : mutate(requests)
    },
    [mutate],
  )

  // 硬刪除,沒有 undo。刪除鈕在右欄,刪的一定是選取中那筆:成功後清掉 task、保留 view;
  // 失敗時 mutate 已經 setError,任務與選取都不動。焦點由 mutate 統一處理(離開視圖的規則)
  const handleDelete = useCallback(
    async (id: number) => {
      const failure = await mutate(() => fetch(`/api/tasks/${id}`, { method: 'DELETE' }))
      if (failure === null) {
        replaceParams((params) => params.delete('task'))
      }
      return failure
    },
    [mutate, replaceParams],
  )

  return (
    <div className={styles.layout}>
      <section className={`${styles.column} ${styles.categories}`}>
        <CategoryColumn view={view} onSelect={handleSelectView} today={today} />
      </section>

      {/* tabIndex={-1}:不進 Tab 順序,只讓程式在任務消失、清單空了時把焦點放過來 */}
      <section
        ref={tasksColumnRef}
        tabIndex={-1}
        aria-label="任務清單"
        className={`${styles.column} ${styles.tasks}`}
      >
        <TaskList
          tasks={visibleTasks}
          overdueCounts={overdueCounts}
          allTasks={tasks}
          view={view}
          loading={loading}
          error={error}
          selectedId={selectedId}
          onSelect={handleSelect}
          onCreate={handleCreate}
          onToggle={handleToggle}
        />
      </section>

      <section className={`${styles.column} ${styles.detail}`}>
        {/* key 換掉 = 換任務就重新掛載:欄位錯誤與確認彈窗的狀態自動回到初始值,
            不必用 effect 偵測 task.id 變化 */}
        <TaskDetail
          key={selectedTask?.id ?? 'empty'}
          task={selectedTask}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
          onSaveDate={handleSaveDate}
          tasksVersion={tasksVersion}
          // setError 是穩定的參考,TaskChecklist 的載入 effect 不會因此重跑
          onChecklistError={setError}
        />
      </section>
    </div>
  )
}
