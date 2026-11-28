import { addDays } from './date'
import type { Task } from './tasks'

// habits、reminders、trash 不是一般任務清單的查詢條件:中欄與右欄各有對應元件
export type ViewId = 'today' | 'next7' | 'open' | 'done' | 'habits' | 'reminders' | 'trash'

// 順序即分類欄的顯示順序(reminders 與 trash 在左欄底部,trash 在最後)
export const VIEWS: { id: ViewId; label: string }[] = [
  { id: 'today', label: '今天' },
  { id: 'next7', label: '未來 7 天' },
  { id: 'open', label: '全部未完成' },
  { id: 'done', label: '已完成' },
  { id: 'habits', label: '習慣' },
  { id: 'reminders', label: '提醒' },
  { id: 'trash', label: '垃圾桶' },
]

// 新增的任務預設沒有 dueDate,落在「今天」會看不到它;預設用未完成的超集
export const DEFAULT_VIEW: ViewId = 'open'

// 白名單:網址上的值是使用者可以亂打的字串,認不得就回預設
export function parseView(raw: string | null): ViewId {
  return VIEWS.some((view) => view.id === raw) ? (raw as ViewId) : DEFAULT_VIEW
}

export type CollapsedView = {
  tasks: Task[]
  // 代表的 id → 同組中代表以外、dueDate < today 的未完成實例數;0 不放
  overdueCounts: Map<number, number>
}

// 日期字串比較,null 排最後(截止日被清掉的實例不搶代表)。字典序就是時間序
function compareNullableDate(a: string | null, b: string | null): number {
  if (a === b) {
    return 0
  }
  if (a === null) {
    return 1
  }
  if (b === null) {
    return -1
  }
  return a < b ? -1 : 1
}

// dueDate 最早的是代表;平手比 occurrenceDate,再比 id
function isEarlier(a: Task, b: Task): boolean {
  return (
    (compareNullableDate(a.dueDate, b.dueDate) ||
      compareNullableDate(a.occurrenceDate, b.occurrenceDate) ||
      a.id - b.id) < 0
  )
}

// 這條規則最早的未完成實例 = 列表視圖裡代表它的那一列;沒有未完成實例時是 undefined。
// 規則寫入後原本選中的實例被刪掉時,右欄改選它
export function earliestIncomplete(tasks: Task[], ruleId: number): Task | undefined {
  let earliest: Task | undefined
  for (const task of tasks) {
    if (task.recurrenceRuleId !== ruleId || task.completedAt !== null) {
      continue
    }
    if (earliest === undefined || isEarlier(task, earliest)) {
      earliest = task
    }
  }
  return earliest
}

// 每條規則的未完成實例只留一個代表:這條規則「現在活著」的那一個。
// 已完成的實例是紀錄,不收合;一般任務原樣保留。只移除,不重排
export function collapseRecurring(tasks: Task[], today: string): CollapsedView {
  const representatives = new Map<number, Task>()
  for (const task of tasks) {
    if (task.recurrenceRuleId === null || task.completedAt !== null) {
      continue
    }
    const current = representatives.get(task.recurrenceRuleId)
    if (current === undefined || isEarlier(task, current)) {
      representatives.set(task.recurrenceRuleId, task)
    }
  }

  const overdueCounts = new Map<number, number>()
  const collapsed = tasks.filter((task) => {
    if (task.recurrenceRuleId === null || task.completedAt !== null) {
      return true
    }
    const representative = representatives.get(task.recurrenceRuleId)!
    if (task === representative) {
      return true
    }
    if (task.dueDate !== null && task.dueDate < today) {
      overdueCounts.set(representative.id, (overdueCounts.get(representative.id) ?? 0) + 1)
    }
    return false
  })

  return { tasks: collapsed, overdueCounts }
}

// 只過濾不排序 —— 順序是 listTasks() 的 ORDER BY 決定的。
// 先收合、後日期篩選:所有視圖共用同一個代表,代表不隨視圖而變。
// 現有視圖的日期條件只有上限,兩種順序結果相同;有下限的視圖(某一天、「明天」)出現時,
// 先篩選會在 9/17 未完成時把 9/18 選為代表(docs/tasks/decisions.md §6a)
export function filterTasks(tasks: Task[], view: ViewId, today: string): CollapsedView {
  const { tasks: collapsed, overdueCounts } = collapseRecurring(tasks, today)
  return { tasks: filterByView(collapsed, view, today), overdueCounts }
}

function filterByView(tasks: Task[], view: ViewId, today: string): Task[] {
  switch (view) {
    // 逾期的要留在今天,所以是 <= 而不是 ===
    case 'today':
      return tasks.filter(
        (task) => task.completedAt === null && task.dueDate !== null && task.dueDate <= today,
      )
    case 'next7': {
      const until = addDays(today, 6)
      return tasks.filter(
        (task) => task.completedAt === null && task.dueDate !== null && task.dueDate <= until,
      )
    }
    case 'open':
      return tasks.filter((task) => task.completedAt === null)
    case 'done':
      return tasks.filter((task) => task.completedAt !== null)
    // 習慣、提醒、垃圾桶視圖不走一般任務清單篩選;回空陣列
    case 'habits':
    case 'reminders':
    case 'trash':
      return []
  }
}
