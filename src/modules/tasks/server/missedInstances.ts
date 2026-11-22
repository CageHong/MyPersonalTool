// 「錯過就跳過」(docs/tasks/decisions.md §6a)上線前的一次性清理:既有實例沒有 editedAt,
// 改用推斷判斷「編輯過」。推斷寧可多留,不誤刪。純函式,不碰資料庫

export type LegacyInstance = {
  title: string
  notes: string | null
  priority: number
  dueDate: string | null
  occurrenceDate: string
  createdAt: number
  // 依 position 排好
  checklist: Array<{ title: string; completedAt: number | null }>
}

export type LegacyRule = {
  title: string
  notes: string | null
  priority: number
  createdAt: number
  // 範本的 checklist 標題,依 position 排好
  template: string[]
}

// 跟規則範本有任何不同就算編輯過:標題、描述、優先級、dueDate ≠ occurrenceDate、
// checklist 標題或順序不同、有勾過的項目;或它是轉成規則的原任務(createdAt 早於規則)
export function looksEdited(instance: LegacyInstance, rule: LegacyRule): boolean {
  if (instance.createdAt < rule.createdAt) {
    return true
  }
  if (instance.title !== rule.title || instance.notes !== rule.notes || instance.priority !== rule.priority) {
    return true
  }
  if (instance.dueDate !== instance.occurrenceDate) {
    return true
  }
  if (instance.checklist.length !== rule.template.length) {
    return true
  }
  return instance.checklist.some(
    (item, index) => item.completedAt !== null || item.title !== rule.template[index],
  )
}
