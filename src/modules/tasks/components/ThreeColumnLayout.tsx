'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { flushSync } from 'react-dom'
import CategoryColumn from './CategoryColumn'
import HabitBlock from './HabitBlock'
import HabitDetail from './HabitDetail'
import HabitList from './HabitList'
import RemindersView from './RemindersView'
import ResizeHandle from './ResizeHandle'
import TaskDetail from './TaskDetail'
import TaskList from './TaskList'
import TrashDetail from './TrashDetail'
import TrashList from './TrashList'
import styles from './ThreeColumnLayout.module.css'
import {
  DEFAULT_LAYOUT,
  LAYOUT_STORAGE_KEY,
  MIN_MIDDLE_WIDTH,
  applyDragWidth,
  clampDragWidth,
  parseStoredLayout,
  resolveLayout,
  type StoredLayout,
} from '@/modules/tasks/lib/layout'
import { useToday } from '@/modules/tasks/lib/useToday'
import {
  generalMessage,
  habitCountMessage,
  habitMessage,
  NETWORK_ERROR,
  readApiError,
  trashMessage,
  type ApiError,
} from '@/modules/tasks/lib/errors'
import { countOf, stepCounts, type HabitItem, type HabitPatch, type PeriodCount } from '@/modules/tasks/lib/habitView'
import {
  arrangeTasks,
  listKeyOf,
  settingsFor,
  type StoredViewSettings,
  type ViewSettings,
} from '@/modules/tasks/lib/listView'
import type { RecurrenceRequest } from '@/modules/tasks/lib/recurrenceDraft'
import type { RecurrenceRuleView } from '@/modules/tasks/lib/recurrence'
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  type NotificationSettings,
  type UpcomingNotificationItem,
} from '@/modules/tasks/lib/reminders'
import { earliestIncomplete, filterTasks, parseView, type ViewId } from '@/modules/tasks/lib/views'
import type { NewTask, Task, TaskPatch } from '@/modules/tasks/lib/tasks'

// 泛用錯誤才有整段訊息可顯示;欄位錯誤由出錯的欄位自己畫在下面
function toGeneralMessage(failure: ApiError): string | null {
  return failure.kind === 'general' ? generalMessage(failure.code) : null
}

// 習慣的一般寫入失敗;欄位錯誤由右欄的欄位自己畫
function toHabitMessage(failure: ApiError): string | null {
  return failure.kind === 'general' ? habitMessage(failure.code) : null
}

// 垃圾桶寫入失敗(還原、永久刪除、清空)
function toTrashMessage(failure: ApiError): string | null {
  return failure.kind === 'general' ? trashMessage(failure.code) : null
}

// 網址上的值(task、habit)是使用者可以亂打的字串;不是正整數就當作沒選取
function parseSelectedId(raw: string | null): number | null {
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
      return fetch(`/api/tasks/tasks/${taskId}/recurrence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request.spec),
      })
    case 'update':
      return fetch(`/api/tasks/recurrence-rules/${request.ruleId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request.changes),
      })
    case 'stop':
      return fetch(`/api/tasks/recurrence-rules/${request.ruleId}/stop`, { method: 'POST' })
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

// 習慣視圖中欄的列,依畫面順序(進行中在前、已停止在後)
function habitRows(column: HTMLElement): HTMLElement[] {
  return Array.from(column.querySelectorAll<HTMLElement>('li[data-habit-id]'))
}

// 刪除習慣後焦點落到遞補的列:同一個索引(下一列),沒有就上一列,清單空了落中欄容器。
// 同任務的規則(decisions §5);只在焦點已經掉到 body 時才動
function restoreHabitFocus(column: HTMLElement, index: number) {
  const active = document.activeElement
  if (active !== null && active !== document.body) {
    return
  }
  const rows = habitRows(column)
  if (rows.length === 0) {
    column.focus()
    return
  }
  const row = rows[Math.min(index, rows.length - 1)]
  ;(row.querySelector<HTMLElement>('[data-habit-control="row"]') ?? column).focus()
}

// 樂觀覆寫值套到習慣上:本週期的筆數與由它推出的進度。streak 等伺服器重算,不在這裡猜
function withOverride(habit: HabitItem, override: PeriodCount[] | undefined): HabitItem {
  if (override === undefined) {
    return habit
  }
  const count = countOf(override)
  return {
    ...habit,
    periodCounts: override,
    progress: { ...habit.progress, count, achieved: habit.target === null ? null : count >= habit.target },
  }
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
  // 各清單存過的分組與排序(伺服器的資料整份替換);沒存過的清單用預設值。
  // 載入完成前不畫清單:先用預設順序畫、設定到了再重排,列會跳一次
  const [viewSettings, setViewSettings] = useState<StoredViewSettings[]>([])
  const [viewSettingsLoading, setViewSettingsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // 寫入排隊:每個動作等前一個(含重抓)結束才開始,所以不必停用任何控制項。
  // 有焦點的元素被停用時瀏覽器會把焦點移到 body;停用也會吞掉寫入期間的點擊。
  // 例:標題編輯中直接點中欄勾選框,失焦觸發的儲存先排進去,勾選排在它後面,兩個都會執行
  const queueRef = useRef<Promise<unknown>>(Promise.resolve())
  // 任務消失後要把焦點放回來的容器(清單空了的落點);tabIndex={-1} 見下方
  const tasksColumnRef = useRef<HTMLElement>(null)
  // 規則寫入(修改、停止)會刪掉今天之後未完成的實例並重生成新 id(R1 的邊界),
  // 選中的正是其中之一時它會消失。寫入期間先不判斷選取;結束後第一次判斷時,
  // 不見的若是剛才寫入規則的那個任務,改選這條規則最早的未完成實例
  const [ruleWritePending, setRuleWritePending] = useState(false)
  const lastRuleWriteRef = useRef<{ taskId: number; ruleId: number } | null>(null)

  // 習慣:伺服器的資料整份替換(同任務)。habitsRef 是同一份的同步複本,計數在事件處理中讀它
  const [habits, setHabits] = useState<HabitItem[]>([])
  const habitsRef = useRef<HabitItem[]>([])
  const [habitsLoading, setHabitsLoading] = useState(true)
  // 習慣計數的樂觀覆寫值(全 app 第二個樂觀更新,decisions §4):習慣 id → 本週期的筆數。
  // ref 同步更新,連按時每一下都讀到上一下的結果;state 是給畫面用的複本。
  // 這個習慣排隊中的 PUT 全部送完、重抓回來後才清掉,中途的重抓不會讓數字倒退
  const countOverridesRef = useRef(new Map<number, PeriodCount[]>())
  const [countOverrides, setCountOverrides] = useState<ReadonlyMap<number, PeriodCount[]>>(new Map())
  const pendingCountsRef = useRef(new Map<number, number>())

  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings>(
    DEFAULT_NOTIFICATION_SETTINGS,
  )
  const [upcomingNotifications, setUpcomingNotifications] = useState<UpcomingNotificationItem[]>([])
  const [recurrenceRules, setRecurrenceRules] = useState<RecurrenceRuleView[]>([])
  const [remindersLoading, setRemindersLoading] = useState(true)

  const today = useToday()
  const view = parseView(searchParams.get('view'))
  // 垃圾桶清單:進入 trash 視圖才抓取,不與一般任務混在同一個 state。
  // inTrashView 記上一次渲染是否在垃圾桶視圖:只在跨進或離開 trash 那一次同步更新 trashLoading,
  // 同一視圖內重繪不會觸發額外 render;切進 trash 當下立即設 true,避免載入前網址清理 effect 誤清 ?task=
  const [trashedTasks, setTrashedTasks] = useState<Task[]>([])
  const [trashLoading, setTrashLoading] = useState(view === 'trash')
  const [inTrashView, setInTrashView] = useState(view === 'trash')
  if (view === 'trash' && !inTrashView) {
    setInTrashView(true)
    setTrashLoading(true)
  } else if (view !== 'trash' && inTrashView) {
    setInTrashView(false)
    setTrashLoading(false)
  }

  // 篩選在前端做,GET /api/tasks/tasks 照舊拿全部。重複實例每條規則只剩一個代表,
  // 非代表的實例不在 visibleTasks 裡,所以也選不到(網址上的 task 會被下面的 effect 清掉)
  const { tasks: visibleTasks, overdueCounts } = filterTasks(tasks, view, today)

  // 分組、排序、置頂只決定畫面上的區塊與順序,不改變「看得到哪些任務」;選取仍從 visibleTasks 找
  const listKey = listKeyOf(view)
  const settings = listKey === null ? null : settingsFor(viewSettings, listKey)
  // 設定還沒載入時先不排:TaskList 這時畫骨架,設定到了才第一次畫出清單(首次出現不播過場)
  const sections =
    settings === null || viewSettingsLoading ? [] : arrangeTasks(visibleTasks, settings, today)

  const selectedId = parseSelectedId(searchParams.get('task'))
  // 從看得到的那些裡面找:選取的任務被檢視濾掉時,下面的 effect 會清掉 task 參數
  const selectedTask =
    view === 'trash'
      ? trashedTasks.find((task) => task.id === selectedId)
      : visibleTasks.find((task) => task.id === selectedId)

  const displayHabits = habits.map((habit) => withOverride(habit, countOverrides.get(habit.id)))
  // 習慣視圖的選取:?view=habits&habit=ID。其他視圖不讀這個參數
  const selectedHabitId = parseSelectedId(searchParams.get('habit'))
  const selectedHabit =
    view === 'habits' ? displayHabits.find((habit) => habit.id === selectedHabitId) : undefined

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

  const handleSelectHabit = useCallback(
    (id: number) => replaceParams((params) => params.set('habit', String(id))),
    [replaceParams],
  )

  const handleSelectView = useCallback(
    (next: ViewId) => replaceParams((params) => params.set('view', next)),
    [replaceParams],
  )

  // 版面欄寬與收合：第一次 render 一律用預設展開，避免 SSR 與 localStorage 不一致
  const layoutRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState<number | null>(null)
  const [storedLayout, setStoredLayout] = useState<StoredLayout>(DEFAULT_LAYOUT)
  const dragRef = useRef<{
    side: 'left' | 'right'
    startX: number
    startWidth: number
    currentWidth: number
  } | null>(null)

  useEffect(() => {
    try {
      // 外部儲存在掛載後同步一次，之後由使用者切換。刻意在 effect 裡讀：伺服器端沒有這個值，
      // render 時讀會 hydration 不一致；這裡多一次 render 是預期的
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStoredLayout(parseStoredLayout(window.localStorage.getItem(LAYOUT_STORAGE_KEY)))
    } catch {
      // 無痕模式或封鎖網站資料時讀不到：維持預設
    }
  }, [])

  useEffect(() => {
    const el = layoutRef.current
    if (el === null) {
      return
    }
    const updateWidth = () => {
      setContainerWidth(el.clientWidth)
    }
    updateWidth()
    const observer = new ResizeObserver(updateWidth)
    observer.observe(el)
    return () => {
      observer.disconnect()
    }
  }, [])

  const effective = resolveLayout(containerWidth, storedLayout)

  const persistLayout = useCallback((next: StoredLayout) => {
    setStoredLayout(next)
    try {
      window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(next))
    } catch {
      // 存不了就只在這次瀏覽有效
    }
  }, [])

  const handleToggleLeft = useCallback(() => {
    if (effective.autoLeftCollapsed) {
      return
    }
    persistLayout({ ...storedLayout, leftCollapsed: !effective.leftCollapsed })
  }, [effective.autoLeftCollapsed, effective.leftCollapsed, persistLayout, storedLayout])

  const handleToggleRight = useCallback(() => {
    if (effective.autoRightCollapsed) {
      return
    }
    persistLayout({ ...storedLayout, rightCollapsed: !effective.rightCollapsed })
  }, [effective.autoRightCollapsed, effective.rightCollapsed, persistLayout, storedLayout])

  const handleResizeStart = useCallback(
    (side: 'left' | 'right', clientX: number) => {
      const startWidth = side === 'left' ? effective.leftWidth : effective.rightWidth
      dragRef.current = { side, startX: clientX, startWidth, currentWidth: startWidth }
      layoutRef.current?.setAttribute('data-resizing', 'true')
    },
    [effective.leftWidth, effective.rightWidth],
  )

  const handleResizeMove = useCallback(
    (side: 'left' | 'right', clientX: number) => {
      const drag = dragRef.current
      const el = layoutRef.current
      if (drag === null || el === null) {
        return
      }
      const delta = clientX - drag.startX
      const raw = side === 'left' ? drag.startWidth + delta : drag.startWidth - delta
      const total = containerWidth ?? el.clientWidth
      const otherWidth = side === 'left' ? effective.rightWidth : effective.leftWidth
      const otherCollapsed = side === 'left' ? effective.rightCollapsed : effective.leftCollapsed
      const clamped = clampDragWidth(side, raw, total, otherWidth, otherCollapsed)
      drag.currentWidth = clamped
      // 拖拉中只寫 --*-width-drag:--*-width 歸 React 的 style prop 管,直接改它的話,
      // 放開後算出的值跟上次 render 相同時 React 不會更新 DOM,畫面會停在拖拉中的值
      el.style.setProperty(side === 'left' ? '--left-width-drag' : '--right-width-drag', `${clamped}px`)
    },
    [containerWidth, effective.leftCollapsed, effective.leftWidth, effective.rightCollapsed, effective.rightWidth],
  )

  const handleResizeEnd = useCallback(
    (side: 'left' | 'right', clientX: number) => {
      const drag = dragRef.current
      const el = layoutRef.current
      if (drag === null) {
        return
      }
      if (el !== null) {
        const delta = clientX - drag.startX
        const raw = side === 'left' ? drag.startWidth + delta : drag.startWidth - delta
        const total = containerWidth ?? el.clientWidth
        const otherWidth = side === 'left' ? effective.rightWidth : effective.leftWidth
        const otherCollapsed = side === 'left' ? effective.rightCollapsed : effective.leftCollapsed
        drag.currentWidth = clampDragWidth(side, raw, total, otherWidth, otherCollapsed)
        el.removeAttribute('data-resizing')
        el.style.removeProperty(side === 'left' ? '--left-width-drag' : '--right-width-drag')
      }
      const finalWidth = drag.currentWidth
      dragRef.current = null
      persistLayout(applyDragWidth(storedLayout, effective, side, finalWidth))
    },
    [containerWidth, effective, persistLayout, storedLayout],
  )

  const handleCloseDrawer = useCallback(() => {
    if (view === 'habits') {
      const targetId = selectedHabitId
      replaceParams((params) => params.delete('habit'))
      if (targetId !== null) {
        tasksColumnRef.current
          ?.querySelector<HTMLElement>(`li[data-habit-id="${targetId}"] [data-habit-control="row"]`)
          ?.focus()
      }
      return
    }
    const targetId = selectedId
    replaceParams((params) => params.delete('task'))
    if (targetId !== null) {
      tasksColumnRef.current
        ?.querySelector<HTMLElement>(`li[data-task-id="${targetId}"] [data-task-control="row"]`)
        ?.focus()
    }
  }, [replaceParams, selectedHabitId, selectedId, view])

  const refetchRules = useCallback(async (): Promise<ApiError | null> => {
    const response = await fetch('/api/tasks/recurrence-rules')
    if (!response.ok) {
      return await readApiError(response)
    }
    setRecurrenceRules((await response.json()) as RecurrenceRuleView[])
    return null
  }, [])

  const refetchNotificationSettings = useCallback(async (): Promise<ApiError | null> => {
    const response = await fetch('/api/tasks/notification-settings')
    if (!response.ok) {
      return await readApiError(response)
    }
    setNotificationSettings((await response.json()) as NotificationSettings)
    return null
  }, [])

  const refetchUpcomingNotifications = useCallback(async (): Promise<ApiError | null> => {
    const response = await fetch('/api/tasks/upcoming-notifications')
    if (!response.ok) {
      return await readApiError(response)
    }
    setUpcomingNotifications((await response.json()) as UpcomingNotificationItem[])
    return null
  }, [])

  // 回傳 null 代表成功;失敗的形狀和寫入共用同一個 ApiError。
  // flushSync:回傳時新清單已經 commit 到 DOM,呼叫端接著就能依畫面上的列移焦點。
  // 這時右欄若已換成空狀態,確認彈窗連同 <dialog> 一起卸載、背景 inert 已解除,focus() 才有效
  const refetch = useCallback(async (): Promise<ApiError | null> => {
    const response = await fetch('/api/tasks/tasks')
    if (!response.ok) {
      return await readApiError(response)
    }
    const next = (await response.json()) as Task[]
    flushSync(() => {
      setTasks(next)
      setTasksVersion((version) => version + 1)
    })
    void refetchRules()
    void refetchUpcomingNotifications()
    return null
  }, [refetchRules, refetchUpcomingNotifications])

  const refetchTrash = useCallback(
    async (signal?: AbortSignal): Promise<ApiError | null> => {
      const response = await fetch('/api/tasks/trash', { signal })
      if (!response.ok) {
        return await readApiError(response)
      }
      const next = (await response.json()) as Task[]
      flushSync(() => {
        setTrashedTasks(next)
      })
      return null
    },
    [setTrashedTasks],
  )

  const refetchViewSettings = useCallback(async (): Promise<ApiError | null> => {
    const response = await fetch('/api/tasks/list-views')
    if (!response.ok) {
      return await readApiError(response)
    }
    setViewSettings((await response.json()) as StoredViewSettings[])
    return null
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const failure = await refetchViewSettings()
        if (failure !== null) {
          setError(toGeneralMessage(failure))
        }
      } catch {
        setError(generalMessage('NETWORK'))
      } finally {
        // 失敗也放行:清單照預設的分組與排序畫,不因為設定讀不到就整欄空白
        setViewSettingsLoading(false)
      }
    })()
  }, [refetchViewSettings])

  const refetchHabits = useCallback(async (): Promise<ApiError | null> => {
    const response = await fetch('/api/tasks/habits')
    if (!response.ok) {
      return await readApiError(response)
    }
    const next = (await response.json()) as HabitItem[]
    habitsRef.current = next
    flushSync(() => setHabits(next))
    void refetchUpcomingNotifications()
    return null
  }, [refetchUpcomingNotifications])

  useEffect(() => {
    void (async () => {
      try {
        const [settingsFailure, upcomingFailure, rulesFailure] = await Promise.all([
          refetchNotificationSettings(),
          refetchUpcomingNotifications(),
          refetchRules(),
        ])
        const failure = settingsFailure ?? upcomingFailure ?? rulesFailure
        if (failure !== null) {
          setError(toGeneralMessage(failure))
        }
      } catch {
        setError(generalMessage('NETWORK'))
      } finally {
        setRemindersLoading(false)
      }
    })()
  }, [refetchNotificationSettings, refetchRules, refetchUpcomingNotifications])

  useEffect(() => {
    void (async () => {
      try {
        const failure = await refetchHabits()
        if (failure !== null) {
          setError(toHabitMessage(failure))
        }
      } catch {
        setError(generalMessage('NETWORK'))
      } finally {
        setHabitsLoading(false)
      }
    })()
  }, [refetchHabits])

  // 習慣視圖的網址指到不存在的習慣(被刪掉、手打的 id)就清掉參數,右欄回空狀態。
  // 其他視圖不管這個參數:切回習慣視圖時選取還在
  useEffect(() => {
    if (view !== 'habits' || habitsLoading || selectedHabitId === null) {
      return
    }
    if (!habits.some((habit) => habit.id === selectedHabitId)) {
      replaceParams((params) => params.delete('habit'))
    }
  }, [habits, habitsLoading, replaceParams, selectedHabitId, view])

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

  useEffect(() => {
    if (view !== 'trash') {
      return
    }
    const controller = new AbortController()
    void (async () => {
      try {
        const failure = await refetchTrash(controller.signal)
        if (!controller.signal.aborted) {
          setError(failure === null ? null : toTrashMessage(failure))
        }
      } catch {
        if (!controller.signal.aborted) {
          setError(generalMessage('NETWORK'))
        }
      } finally {
        if (!controller.signal.aborted) {
          setTrashLoading(false)
        }
      }
    })()
    return () => {
      controller.abort()
    }
  }, [refetchTrash, view])

  // 網址指到看不到的任務(被刪掉、手打的 id、被檢視濾掉)就把參數清掉,右欄回空狀態。
  // 要等 loading 結束才判斷,否則首次載入時 tasks 還是空的,合法的 ?task= 會被誤刪。
  // 從右欄刪除時由 handleDelete 在成功後直接清,不靠這個 effect;兩邊都清也是同一個結果。
  // 規則寫入的例外:不見的是剛寫入規則的那個任務時,改選這條規則最早的未完成實例;
  // 沒有任何未完成實例才清掉。改選的實例被目前檢視濾掉的話,下一輪照常清掉
  useEffect(() => {
    if (ruleWritePending) {
      return
    }
    // 寫入結束後只用一次:之後任務因為別的原因(刪除)消失,照原本的規則清掉
    const ruleWrite = lastRuleWriteRef.current
    lastRuleWriteRef.current = null
    const selectionLoading = view === 'trash' ? trashLoading : loading
    if (selectionLoading || selectedId === null || selectedTask !== undefined) {
      return
    }
    if (
      view !== 'trash' &&
      ruleWrite !== null &&
      ruleWrite.taskId === selectedId &&
      !tasks.some((task) => task.id === selectedId)
    ) {
      const next = earliestIncomplete(tasks, ruleWrite.ruleId)
      if (next !== undefined) {
        replaceParams((params) => params.set('task', String(next.id)))
        return
      }
    }
    replaceParams((params) => params.delete('task'))
  }, [loading, replaceParams, ruleWritePending, selectedId, selectedTask, tasks, trashLoading, view])

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
    (
      requests: (() => Promise<Response>) | (() => Promise<Response>)[],
      options?: { includeTrash?: boolean; errorMessage?: (failure: ApiError) => string | null },
    ): Promise<ApiError | null> => {
      const list = Array.isArray(requests) ? requests : [requests]
      const formatError = options?.errorMessage ?? toGeneralMessage
      const includeTrash = options?.includeTrash ?? false
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
                await (includeTrash ? Promise.all([refetch(), refetchTrash()]) : refetch())
              }
              setError(formatError(failure))
              return failure
            }
          }

          const [refetchFailure, trashFailure] = includeTrash
            ? await Promise.all([refetch(), refetchTrash()])
            : [await refetch(), null]
          const failure = refetchFailure ?? trashFailure
          setError(failure === null ? null : formatError(failure))
          // 失敗時任務與焦點都不動
          if (failure === null && focus !== null && tasksColumnRef.current !== null) {
            restoreFocus(tasksColumnRef.current, focus)
          }
          return failure
        } catch {
          setError(generalMessage('NETWORK'))
          return NETWORK_ERROR
        }
      })
    },
    [enqueue, refetch, refetchTrash],
  )

  const handleCreate = useCallback(
    (input: NewTask) =>
      mutate(() =>
        fetch('/api/tasks/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }),
      ),
    [mutate],
  )

  // 批次貼上:一個請求、一個 transaction,整批成功才出現在清單裡
  const handleCreateMany = useCallback(
    (inputs: NewTask[]) =>
      mutate(() =>
        fetch('/api/tasks/tasks/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tasks: inputs }),
        }),
      ),
    [mutate],
  )

  // 目前清單的分組與排序:整份 PUT,成功後重抓設定(同任務:不拿回應更新 state,不做樂觀更新)。
  // 排進同一條佇列;任務本身沒變,不重抓任務
  const handleChangeSettings = useCallback(
    (next: ViewSettings) => {
      if (listKey === null) {
        return
      }
      void enqueue(async () => {
        try {
          const response = await fetch(`/api/tasks/list-views/${listKey}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(next),
          })
          if (!response.ok) {
            setError(toGeneralMessage(await readApiError(response)))
            return
          }
          const refetchFailure = await refetchViewSettings()
          setError(refetchFailure === null ? null : toGeneralMessage(refetchFailure))
        } catch {
          setError(generalMessage('NETWORK'))
        }
      })
    },
    [enqueue, listKey, refetchViewSettings],
  )

  // 完成狀態只由 completedAt 表示,沒有布林欄位;
  // API 收 done,完成時間由伺服器寫入(重複送完成不會改寫原本的時間)
  const handleToggle = useCallback(
    (task: Task) =>
      mutate(() =>
        fetch(`/api/tasks/tasks/${task.id}`, {
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
        fetch(`/api/tasks/tasks/${id}`, {
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
          fetch(`/api/tasks/tasks/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dueDate }),
          }),
        )
      }
      if (recurrence !== undefined) {
        requests.push(() => recurrenceRequest(id, recurrence))
      }
      if (requests.length === 0) {
        return Promise.resolve(null)
      }
      // 新建不刪實例(任務本身成為第一個實例),只有修改與停止會讓選中的任務消失
      if (recurrence === undefined || recurrence.kind === 'create') {
        return mutate(requests)
      }
      lastRuleWriteRef.current = { taskId: id, ruleId: recurrence.ruleId }
      setRuleWritePending(true)
      return mutate(requests).finally(() => setRuleWritePending(false))
    },
    [mutate],
  )

  // 軟刪除(移進垃圾桶,不跳確認)。刪除鈕在右欄,刪的一定是選取中那筆:成功後清掉 task、保留 view;
  // 失敗時 mutate 已經 setError,任務與選取都不動。焦點由 mutate 統一處理(離開視圖的規則)
  const handleDelete = useCallback(
    async (id: number) => {
      const failure = await mutate(() => fetch(`/api/tasks/tasks/${id}`, { method: 'DELETE' }))
      if (failure === null) {
        replaceParams((params) => params.delete('task'))
      }
      return failure
    },
    [mutate, replaceParams],
  )

  // 從垃圾桶還原:重抓一般清單與垃圾桶清單,成功後清掉 task,焦點由 mutate 遞補
  const handleRestore = useCallback(
    async (id: number) => {
      const failure = await mutate(
        () => fetch(`/api/tasks/trash/${id}/restore`, { method: 'POST' }),
        { includeTrash: true, errorMessage: toTrashMessage },
      )
      if (failure === null) {
        replaceParams((params) => params.delete('task'))
      }
      return failure
    },
    [mutate, replaceParams],
  )

  // 永久刪除單筆垃圾桶任務:重抓一般清單與垃圾桶清單,成功後清掉 task,焦點由 mutate 遞補
  const handlePurge = useCallback(
    async (id: number) => {
      const failure = await mutate(
        () => fetch(`/api/tasks/trash/${id}`, { method: 'DELETE' }),
        { includeTrash: true, errorMessage: toTrashMessage },
      )
      if (failure === null) {
        replaceParams((params) => params.delete('task'))
      }
      return failure
    },
    [mutate, replaceParams],
  )

  // 清空垃圾桶:重抓一般清單與垃圾桶清單,成功後清掉 task;清空鈕卸載使焦點掉到 body 時移回中欄容器
  const handleEmptyTrash = useCallback(async () => {
    const failure = await mutate(() => fetch('/api/tasks/trash', { method: 'DELETE' }), {
      includeTrash: true,
      errorMessage: toTrashMessage,
    })
    if (failure === null) {
      replaceParams((params) => params.delete('task'))
      const active = document.activeElement
      if (active === null || active === document.body) {
        tasksColumnRef.current?.focus()
      }
    }
    return failure
  }, [mutate, replaceParams])

  // 習慣的一般寫入(新增以外):排進同一條佇列,成功後整份重抓習慣,不做樂觀更新。
  // 回傳 null 代表成功;欄位錯誤原樣回傳給右欄,不進中欄的錯誤區
  const mutateHabit = useCallback(
    (request: () => Promise<Response>): Promise<ApiError | null> =>
      enqueue(async () => {
        try {
          const response = await request()
          if (!response.ok) {
            const failure = await readApiError(response)
            setError(toHabitMessage(failure))
            return failure
          }
          const refetchFailure = await refetchHabits()
          setError(refetchFailure === null ? null : toHabitMessage(refetchFailure))
          return refetchFailure
        } catch {
          setError(generalMessage('NETWORK'))
          return NETWORK_ERROR
        }
      }),
    [enqueue, refetchHabits],
  )

  const clearCountOverride = useCallback((id: number) => {
    if (countOverridesRef.current.delete(id)) {
      setCountOverrides(new Map(countOverridesRef.current))
    }
  }, [])

  // 圈圈的一步(+1 / -1)。新值由覆寫值(沒有就用伺服器值)經 stepCounts 算出,
  // 同一個結果同時拿來顯示與送出,不拿伺服器回來的舊值另外算,連按時兩者才不會分岔。
  // PUT 送絕對值:最後一筆決定結果,中途的請求順序不影響最終狀態(decisions §6b)
  const stepHabit = useCallback(
    (habit: HabitItem, delta: 1 | -1) => {
      const id = habit.id
      const base =
        countOverridesRef.current.get(id) ??
        habitsRef.current.find((item) => item.id === id)?.periodCounts ??
        []
      const step = stepCounts(base, today, delta)
      // 本週期沒有紀錄可退
      if (step.writes.length === 0) {
        return
      }
      countOverridesRef.current.set(id, step.periodCounts)
      setCountOverrides(new Map(countOverridesRef.current))
      pendingCountsRef.current.set(id, (pendingCountsRef.current.get(id) ?? 0) + 1)

      void enqueue(async () => {
        let failure: ApiError | null = null
        try {
          for (const write of step.writes) {
            const response = await fetch(`/api/tasks/habits/${id}/logs?date=${write.date}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ count: write.count }),
            })
            if (!response.ok) {
              failure = await readApiError(response)
              break
            }
          }
        } catch {
          failure = NETWORK_ERROR
        }

        const remaining = (pendingCountsRef.current.get(id) ?? 1) - 1
        if (remaining === 0) {
          pendingCountsRef.current.delete(id)
        } else {
          pendingCountsRef.current.set(id, remaining)
        }

        // 失敗:清掉覆寫值並重抓,畫面回到伺服器的真實值;訊息講明次數已還原,不靜靜還原
        if (failure !== null) {
          clearCountOverride(id)
          setError(habitCountMessage(failure.kind === 'general' ? failure.code : 'VALIDATION_FAILED'))
        }
        try {
          const refetchFailure = await refetchHabits()
          if (failure === null) {
            setError(refetchFailure === null ? null : toHabitMessage(refetchFailure))
          }
        } catch {
          if (failure === null) {
            setError(generalMessage('NETWORK'))
          }
        }
        // 這個習慣排隊中的 PUT 都送完了:伺服器的值已經追上,覆寫值功成身退
        if (remaining === 0) {
          clearCountOverride(id)
        }
      })
    },
    [clearCountOverride, enqueue, refetchHabits, today],
  )

  // 新增習慣:預設每天 1 次,頻率與目標到右欄再改。成功後選取它、打開右欄;
  // 焦點不動,留在新增列的輸入框,可以連續新增
  const handleCreateHabit = useCallback(
    (name: string) =>
      enqueue(async (): Promise<ApiError | null> => {
        try {
          const response = await fetch('/api/tasks/habits', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, periodType: 'daily', target: 1 }),
          })
          if (!response.ok) {
            const failure = await readApiError(response)
            setError(toHabitMessage(failure))
            return failure
          }
          const created = (await response.json()) as { id: number }
          const refetchFailure = await refetchHabits()
          setError(refetchFailure === null ? null : toHabitMessage(refetchFailure))
          replaceParams((params) => params.set('habit', String(created.id)))
          return refetchFailure
        } catch {
          setError(generalMessage('NETWORK'))
          return NETWORK_ERROR
        }
      }),
    [enqueue, refetchHabits, replaceParams],
  )

  const handleUpdateHabit = useCallback(
    (id: number, patch: HabitPatch) =>
      mutateHabit(() =>
        fetch(`/api/tasks/habits/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        }),
      ),
    [mutateHabit],
  )

  // 停止與重新開始是動作,不是欄位;選取不變,習慣在中欄移到「已停止」或移回來
  const handleTogglePause = useCallback(
    (habit: HabitItem) =>
      mutateHabit(() =>
        fetch(`/api/tasks/habits/${habit.id}/${habit.paused ? 'resume' : 'pause'}`, { method: 'POST' }),
      ),
    [mutateHabit],
  )

  // 硬刪除,連同所有紀錄(確認彈窗寫明筆數)。成功後清掉 habit,焦點落到遞補的列
  const handleDeleteHabit = useCallback(
    async (id: number) => {
      const column = tasksColumnRef.current
      const index =
        column === null ? -1 : habitRows(column).findIndex((row) => row.dataset.habitId === String(id))
      const failure = await mutateHabit(() => fetch(`/api/tasks/habits/${id}`, { method: 'DELETE' }))
      if (failure === null) {
        replaceParams((params) => params.delete('habit'))
        if (column !== null && index !== -1) {
          restoreHabitFocus(column, index)
        }
      }
      return failure
    },
    [mutateHabit, replaceParams],
  )

  const handleUpdateRule = useCallback(
    (ruleId: number, patch: { excludeFromSummary: boolean }) =>
      mutate(() =>
        fetch(`/api/tasks/recurrence-rules/${ruleId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        }),
      ),
    [mutate],
  )

  const handleSaveNotificationSettings = useCallback(
    (next: NotificationSettings): Promise<ApiError | null> =>
      enqueue(async () => {
        try {
          const response = await fetch('/api/tasks/notification-settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(next),
          })
          if (!response.ok) {
            const failure = await readApiError(response)
            setError(toGeneralMessage(failure))
            return failure
          }
          const [settingsFailure, upcomingFailure] = await Promise.all([
            refetchNotificationSettings(),
            refetchUpcomingNotifications(),
          ])
          const refetchFailure = settingsFailure ?? upcomingFailure
          setError(refetchFailure === null ? null : toGeneralMessage(refetchFailure))
          return refetchFailure
        } catch {
          setError(generalMessage('NETWORK'))
          return NETWORK_ERROR
        }
      }),
    [enqueue, refetchNotificationSettings, refetchUpcomingNotifications],
  )

  const handleReminderChanged = useCallback(() => {
    void refetchUpcomingNotifications()
  }, [refetchUpcomingNotifications])

  const handleOpenTaskFromReminders = useCallback(
    (taskId: number, targetView: ViewId = 'open') => {
      replaceParams((params) => {
        params.set('view', targetView)
        params.delete('habit')
        params.set('task', String(taskId))
      })
    },
    [replaceParams],
  )

  const handleOpenHabitFromReminders = useCallback(
    (habitId: number) => {
      replaceParams((params) => {
        params.set('view', 'habits')
        params.delete('task')
        params.set('habit', String(habitId))
      })
    },
    [replaceParams],
  )

  // 中欄小區塊只在今天與全部未完成出現;習慣還在載入時不畫,免得先閃一下空狀態
  const habitBlock =
    (view === 'today' || view === 'open') && !habitsLoading ? (
      <HabitBlock habits={displayHabits} onStep={stepHabit} />
    ) : undefined

  const hasSelection =
    view === 'habits'
      ? selectedHabit !== undefined
      : view === 'reminders'
        ? false
        : selectedTask !== undefined
  const drawerOpen = effective.rightCollapsed && hasSelection
  const showDetailColumn = view !== 'reminders' && (!effective.rightCollapsed || drawerOpen)

  const leftToggle = (
    <button
      type="button"
      className={styles.toggleButton}
      aria-label={effective.leftCollapsed ? '展開左欄' : '收合左欄'}
      aria-expanded={!effective.leftCollapsed}
      aria-disabled={effective.autoLeftCollapsed || undefined}
      title={effective.autoLeftCollapsed ? '視窗太窄' : effective.leftCollapsed ? '展開左欄' : '收合左欄'}
      onClick={handleToggleLeft}
    >
      {effective.leftCollapsed ? '▸' : '◂'}
    </button>
  )

  const rightToggle = (
    <button
      type="button"
      className={styles.toggleButton}
      aria-label={effective.rightCollapsed ? '展開右欄' : '收合右欄'}
      aria-expanded={!effective.rightCollapsed}
      aria-disabled={effective.autoRightCollapsed || undefined}
      title={effective.autoRightCollapsed ? '視窗太窄' : effective.rightCollapsed ? '展開右欄' : '收合右欄'}
      onClick={handleToggleRight}
    >
      {effective.rightCollapsed ? '◂' : '▸'}
    </button>
  )

  const layoutStyle = {
    '--left-width': `${effective.leftWidth}px`,
    '--right-width': `${effective.rightWidth}px`,
    '--middle-min-width': `${MIN_MIDDLE_WIDTH}px`,
  } as CSSProperties

  return (
    <div ref={layoutRef} className={styles.layout} style={layoutStyle}>
      {!effective.leftCollapsed && (
        <>
          <section className={`${styles.column} ${styles.categories}`}>
            <CategoryColumn view={view} onSelect={handleSelectView} today={today} />
          </section>
          <div className={styles.handleAnchor}>
            <ResizeHandle
              side="left"
              ariaLabel="調整左欄寬度"
              onResizeStart={handleResizeStart}
              onResizeMove={handleResizeMove}
              onResizeEnd={handleResizeEnd}
            />
          </div>
        </>
      )}

      {/* tabIndex={-1}:不進 Tab 順序,只讓程式在任務消失、清單空了時把焦點放過來 */}
      <section
        ref={tasksColumnRef}
        tabIndex={-1}
        aria-label={
          view === 'habits'
            ? '習慣清單'
            : view === 'reminders'
              ? '提醒'
              : view === 'trash'
                ? '垃圾桶'
                : '任務清單'
        }
        className={
          effective.rightCollapsed || view === 'reminders'
            ? `${styles.column} ${styles.tasks} ${styles.tasksNoRightBorder}`
            : `${styles.column} ${styles.tasks}`
        }
      >
        {view === 'reminders' ? (
          <RemindersView
            settings={notificationSettings}
            upcoming={upcomingNotifications}
            tasks={tasks}
            rules={recurrenceRules}
            habits={displayHabits}
            today={today}
            loading={loading || habitsLoading || remindersLoading}
            error={error}
            onSaveSettings={handleSaveNotificationSettings}
            onOpenTask={handleOpenTaskFromReminders}
            onOpenHabit={handleOpenHabitFromReminders}
            leftToggle={leftToggle}
          />
        ) : view === 'habits' ? (
          <HabitList
            habits={displayHabits}
            loading={habitsLoading}
            error={error}
            selectedId={selectedHabitId}
            onSelect={handleSelectHabit}
            onCreate={handleCreateHabit}
            onStep={stepHabit}
            leftToggle={leftToggle}
            rightToggle={drawerOpen ? undefined : rightToggle}
          />
        ) : view === 'trash' ? (
          <TrashList
            tasks={trashedTasks}
            today={today}
            loading={trashLoading}
            error={error}
            selectedId={selectedId}
            onSelect={handleSelect}
            onEmpty={handleEmptyTrash}
            leftToggle={leftToggle}
            rightToggle={drawerOpen ? undefined : rightToggle}
          />
        ) : (
          <TaskList
            sections={sections}
            // 走到這裡 view 一定是任務的清單,settings 不會是 null;型別上補一個預設
            settings={settings ?? settingsFor([], 'open')}
            onChangeSettings={handleChangeSettings}
            overdueCounts={overdueCounts}
            allTasks={tasks}
            view={view}
            today={today}
            loading={loading || viewSettingsLoading}
            error={error}
            selectedId={selectedId}
            onSelect={handleSelect}
            onCreate={handleCreate}
            onCreateMany={handleCreateMany}
            onToggle={handleToggle}
            habitBlock={habitBlock}
            leftToggle={leftToggle}
            rightToggle={drawerOpen ? undefined : rightToggle}
          />
        )}
      </section>

      {!effective.rightCollapsed && view !== 'reminders' && (
        <div className={styles.handleAnchor}>
          <ResizeHandle
            side="right"
            ariaLabel="調整右欄寬度"
            onResizeStart={handleResizeStart}
            onResizeMove={handleResizeMove}
            onResizeEnd={handleResizeEnd}
          />
        </div>
      )}

      {showDetailColumn && (
        <section
          aria-label={drawerOpen ? '詳細內容抽屜' : undefined}
          className={
            drawerOpen ? `${styles.column} ${styles.detail} ${styles.detailDrawer}` : `${styles.column} ${styles.detail}`
          }
        >
          {drawerOpen && (
            <div className={styles.drawerHeader}>
              <button type="button" className={styles.drawerClose} onClick={handleCloseDrawer}>
                關閉
              </button>
              {rightToggle}
            </div>
          )}
          {/* key 換掉 = 換任務就重新掛載:欄位錯誤與確認彈窗的狀態自動回到初始值,
              不必用 effect 偵測 task.id 變化 */}
          {view === 'habits' ? (
            // 同一個理由:換習慣就重新掛載,草稿、欄位錯誤、確認彈窗隨卸載清除
            <HabitDetail
              key={selectedHabit?.id ?? 'empty'}
              habit={selectedHabit}
              today={today}
              onUpdate={handleUpdateHabit}
              onTogglePause={handleTogglePause}
              onDelete={handleDeleteHabit}
              onError={setError}
              onReminderChanged={handleReminderChanged}
            />
          ) : view === 'trash' ? (
            <TrashDetail
              key={selectedTask?.id ?? 'empty'}
              task={selectedTask}
              today={today}
              tasksVersion={tasksVersion}
              onRestore={handleRestore}
              onPurge={handlePurge}
              onError={setError}
            />
          ) : (
            <TaskDetail
              key={selectedTask?.id ?? 'empty'}
              task={selectedTask}
              today={today}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
              onSaveDate={handleSaveDate}
              tasksVersion={tasksVersion}
              // setError 是穩定的參考,TaskChecklist 的載入 effect 不會因此重跑
              onChecklistError={setError}
              onUpdateRule={handleUpdateRule}
              onReminderChanged={handleReminderChanged}
            />
          )}
        </section>
      )}
    </div>
  )
}
