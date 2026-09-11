import { addDays } from './date'
import type { Task } from './tasks'

export type ViewId = 'today' | 'next7' | 'open' | 'done'

// 順序即分類欄的顯示順序
export const VIEWS: { id: ViewId; label: string }[] = [
  { id: 'today', label: '今天' },
  { id: 'next7', label: '未來 7 天' },
  { id: 'open', label: '全部未完成' },
  { id: 'done', label: '已完成' },
]

// 新增的任務預設沒有 dueDate,落在「今天」會看不到它;預設用未完成的超集
export const DEFAULT_VIEW: ViewId = 'open'

// 白名單:網址上的值是使用者可以亂打的字串,認不得就回預設
export function parseView(raw: string | null): ViewId {
  return VIEWS.some((view) => view.id === raw) ? (raw as ViewId) : DEFAULT_VIEW
}

// 只過濾不排序 —— 順序是 listTasks() 的 ORDER BY 決定的
export function filterTasks(tasks: Task[], view: ViewId, today: string): Task[] {
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
  }
}
