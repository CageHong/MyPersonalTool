// 前端不 import src/modules/tasks/server/,型別在這裡自行宣告;只列畫面用得到的欄位
export type ChecklistItem = {
  id: number
  title: string
  position: number
  // null = 未勾
  completedAt: number | null
}

// PATCH /api/tasks/checklist-items/:itemId 的 body;一次只送一個欄位
export type ChecklistItemPatch = { title: string } | { done: boolean }
