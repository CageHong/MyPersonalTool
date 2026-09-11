// 前端不 import src/server/,型別在這裡自行宣告;只列畫面用得到的欄位
export type Task = {
  id: number
  title: string
  notes: string | null
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
