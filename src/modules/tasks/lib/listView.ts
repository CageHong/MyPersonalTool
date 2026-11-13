// 清單的呈現:分組、排序、置頂(docs/tasks/decisions.md §6d)。
// 前後端共用:伺服器用這裡的值域驗證設定,前端用 arrangeTasks 把篩選後的任務排成區塊。
// 不碰資料庫,也不讀時鐘:「今天」由呼叫端傳入,和 views.ts 的日期篩選共用同一份
import { addDays, WEEK_START, weekday } from './date'
import { PRIORITY_OPTIONS, type Task } from './tasks'
import type { ViewId } from './views'

export const GROUP_BY_VALUES = ['none', 'date', 'priority'] as const
export const SORT_BY_VALUES = ['created', 'dueDate', 'priority', 'title'] as const
export const SORT_DIRECTION_VALUES = ['asc', 'desc'] as const

export type GroupBy = (typeof GROUP_BY_VALUES)[number]
export type SortBy = (typeof SORT_BY_VALUES)[number]
export type SortDirection = (typeof SORT_DIRECTION_VALUES)[number]

export type ViewSettings = {
  groupBy: GroupBy
  sortBy: SortBy
  sortDirection: SortDirection
}

// GET /api/tasks/list-views 的一筆
export type StoredViewSettings = ViewSettings & { listKey: string }

// 有設定可存的清單:畫任務的智慧檢視。習慣視圖不走任務的分組與排序
export const LIST_KEYS = ['today', 'next7', 'open', 'done'] as const
export type ListKey = (typeof LIST_KEYS)[number]

export function isListKey(value: unknown): value is ListKey {
  return typeof value === 'string' && (LIST_KEYS as readonly string[]).includes(value)
}

export function listKeyOf(view: ViewId): ListKey | null {
  return isListKey(view) ? view : null
}

// 選單的顯示順序即陣列順序
export const GROUP_BY_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: 'none', label: '不分組' },
  { value: 'date', label: '日期' },
  { value: 'priority', label: '優先級' },
]

export const SORT_BY_OPTIONS: { value: SortBy; label: string }[] = [
  { value: 'created', label: '建立時間' },
  { value: 'dueDate', label: '截止日' },
  { value: 'priority', label: '優先級' },
  { value: 'title', label: '標題' },
]

// 換排序欄位時的起始方向:日期由近到遠、優先級由高到低、其餘由小到大
export const DEFAULT_DIRECTION: Record<SortBy, SortDirection> = {
  created: 'asc',
  dueDate: 'asc',
  priority: 'desc',
  title: 'asc',
}

// 方向的說法跟著欄位走;「升冪/降冪」對日期與優先級不直覺
export const DIRECTION_LABELS: Record<SortBy, Record<SortDirection, string>> = {
  created: { asc: '舊的在前', desc: '新的在前' },
  dueDate: { asc: '近的在前', desc: '遠的在前' },
  priority: { asc: '低的在前', desc: '高的在前' },
  title: { asc: 'A → Z', desc: 'Z → A' },
}

// 沒有存過設定時的值。今天與未來 7 天預設依日期分組:逾期、今天、之後要分得開;
// 其餘維持原本的樣子(不分組、依建立時間)
const BASE_SETTINGS: ViewSettings = { groupBy: 'none', sortBy: 'created', sortDirection: 'asc' }
const DEFAULT_SETTINGS: Record<ListKey, ViewSettings> = {
  today: { ...BASE_SETTINGS, groupBy: 'date' },
  next7: { ...BASE_SETTINGS, groupBy: 'date' },
  open: BASE_SETTINGS,
  done: BASE_SETTINGS,
}

export function defaultSettings(listKey: ListKey): ViewSettings {
  return DEFAULT_SETTINGS[listKey]
}

// 存過的優先;沒有就用預設
export function settingsFor(stored: StoredViewSettings[], listKey: ListKey): ViewSettings {
  const found = stored.find((item) => item.listKey === listKey)
  if (found === undefined) {
    return defaultSettings(listKey)
  }
  return { groupBy: found.groupBy, sortBy: found.sortBy, sortDirection: found.sortDirection }
}

export type Section = {
  // 同一份清單內唯一;畫面用它當 React key
  key: string
  // null = 不畫標題(沒有分組、也沒有置頂區塊時的唯一一區)
  label: string | null
  tasks: Task[]
}

// 決勝鍵:建立時間,再以 id 打破平手。少了它,同值的任務每次重抓順序可能跳動
function compareCreated(a: Task, b: Task): number {
  return a.createdAt - b.createdAt || a.id - b.id
}

const collator = new Intl.Collator('zh-Hant', { numeric: true, sensitivity: 'base' })

// 空值沉底:沒有日期、沒有優先級的不論方向都排最後。
// 「未設定」不是一個等級,夾在有值的任務之間會被誤讀成介於兩者之間
function compareBy(settings: ViewSettings): (a: Task, b: Task) => number {
  const sign = settings.sortDirection === 'asc' ? 1 : -1
  switch (settings.sortBy) {
    case 'created':
      return (a, b) => sign * compareCreated(a, b)
    case 'dueDate':
      return (a, b) => {
        if (a.dueDate === b.dueDate) {
          return compareCreated(a, b)
        }
        if (a.dueDate === null) {
          return 1
        }
        if (b.dueDate === null) {
          return -1
        }
        // ISO 字串的字典序就是時間序
        return sign * (a.dueDate < b.dueDate ? -1 : 1)
      }
    case 'priority':
      return (a, b) => {
        if (a.priority === b.priority) {
          return compareCreated(a, b)
        }
        if (a.priority === 0) {
          return 1
        }
        if (b.priority === 0) {
          return -1
        }
        return sign * (a.priority - b.priority)
      }
    case 'title':
      return (a, b) => sign * collator.compare(a.title, b.title) || compareCreated(a, b)
  }
}

type Bucket = { key: string; label: string }

// 依日期的桶是相對今天算出來的,不是欄位值。順序固定,不跟排序方向走
const DATE_BUCKETS: Bucket[] = [
  { key: 'overdue', label: '逾期' },
  { key: 'today', label: '今天' },
  { key: 'tomorrow', label: '明天' },
  { key: 'thisWeek', label: '本週' },
  { key: 'later', label: '更晚' },
  { key: 'noDate', label: '無日期' },
]

function dateBucket(dueDate: string | null, today: string): string {
  if (dueDate === null) {
    return 'noDate'
  }
  if (dueDate < today) {
    return 'overdue'
  }
  if (dueDate === today) {
    return 'today'
  }
  // 專稱優先:今天是一週的最後一天時,明天屬於下週,仍歸「明天」
  if (dueDate === addDays(today, 1)) {
    return 'tomorrow'
  }
  // 本週最後一天;一週的起始日見 WEEK_START
  const weekEnd = addDays(today, (WEEK_START + 6 - weekday(today) + 7) % 7)
  return dueDate <= weekEnd ? 'thisWeek' : 'later'
}

// 高 → 中 → 低 → 無;標籤沿用 PRIORITY_OPTIONS,不重打第二次
const PRIORITY_BUCKETS: Bucket[] = [...PRIORITY_OPTIONS]
  .sort((a, b) => (a.value === 0 ? 1 : b.value === 0 ? -1 : b.value - a.value))
  .map((option) => ({ key: `priority-${option.value}`, label: option.value === 0 ? '無優先級' : option.label }))

function group(tasks: Task[], settings: ViewSettings, today: string): Section[] {
  if (settings.groupBy === 'none') {
    return tasks.length === 0 ? [] : [{ key: 'all', label: null, tasks }]
  }
  const buckets = settings.groupBy === 'date' ? DATE_BUCKETS : PRIORITY_BUCKETS
  const keyOf = (task: Task) =>
    settings.groupBy === 'date' ? dateBucket(task.dueDate, today) : `priority-${task.priority}`

  const byKey = new Map<string, Task[]>()
  for (const task of tasks) {
    const key = keyOf(task)
    const bucket = byKey.get(key)
    if (bucket === undefined) {
      byKey.set(key, [task])
    } else {
      bucket.push(task)
    }
  }
  // 空的桶不畫
  return buckets.flatMap((bucket) => {
    const members = byKey.get(bucket.key)
    return members === undefined ? [] : [{ key: bucket.key, label: bucket.label, tasks: members }]
  })
}

// 篩選後的任務 → 畫面上的區塊,由上到下。
// 置頂是跨分組的獨立區塊:置頂任務從原本的分組抽離、固定在最上方,所以各分組的筆數不含它們。
// 已完成的任務不進置頂區塊:完成的事不需要再被看見第一眼
export function arrangeTasks(tasks: Task[], settings: ViewSettings, today: string): Section[] {
  const sorted = [...tasks].sort(compareBy(settings))
  const pinned = sorted.filter((task) => task.pinned && task.completedAt === null)
  if (pinned.length === 0) {
    return group(sorted, settings, today)
  }

  const pinnedIds = new Set(pinned.map((task) => task.id))
  const rest = group(
    sorted.filter((task) => !pinnedIds.has(task.id)),
    settings,
    today,
  )
  // 沒有分組時剩下的那一區補上標題,否則置頂區塊下面接一段沒有名字的清單
  const labelled = rest.map((section) => (section.label === null ? { ...section, label: '其他' } : section))
  return [{ key: 'pinned', label: '置頂', tasks: pinned }, ...labelled]
}
