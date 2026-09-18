// 前端不 import src/server/,型別在這裡自行宣告;只列畫面用得到的欄位
export type ChecklistItem = {
  id: number
  title: string
  position: number
  // null = 未勾
  completedAt: number | null
}

// PATCH /api/checklist-items/:itemId 的 body;一次只送一個欄位
export type ChecklistItemPatch = { title: string } | { done: boolean }

// 鍵盤連續輸入時,只存在於前端的草稿列。伺服器沒有對應資料,所以不違反「畫面是資料庫的投影」:
// 清單本身(items)仍只由重抓整份替換
export type DraftAnchor = { kind: 'item'; id: number } | { kind: 'draft'; key: string }

export type ChecklistDraft = {
  // 前端產生;React key、焦點與排隊 job 都用它找這一列
  key: string
  // 顯示在誰的正下方,也是 POST afterItemId 的來源
  anchor: DraftAnchor
  value: string
  // pending = 已送出,等重抓帶回正式項目
  status: 'editing' | 'pending'
}

export type ChecklistRow =
  | { kind: 'item'; item: ChecklistItem }
  | { kind: 'draft'; draft: ChecklistDraft }

function sameAnchor(a: DraftAnchor, b: DraftAnchor): boolean {
  return a.kind === 'item'
    ? b.kind === 'item' && a.id === b.id
    : b.kind === 'draft' && a.key === b.key
}

// 伺服器的項目依序排,每一項後面接上錨點指向它的草稿,草稿後面再接錨點指向該草稿的草稿。
// 錨點已經不在畫面上的草稿接在最後,不會消失
export function buildChecklistRows(
  items: ChecklistItem[],
  drafts: ChecklistDraft[],
): ChecklistRow[] {
  const rows: ChecklistRow[] = []
  const placed = new Set<string>()

  function appendDraftsAfter(anchor: DraftAnchor) {
    for (const draft of drafts) {
      if (!placed.has(draft.key) && sameAnchor(draft.anchor, anchor)) {
        placed.add(draft.key)
        rows.push({ kind: 'draft', draft })
        appendDraftsAfter({ kind: 'draft', key: draft.key })
      }
    }
  }

  for (const item of items) {
    rows.push({ kind: 'item', item })
    appendDraftsAfter({ kind: 'item', id: item.id })
  }
  for (const draft of drafts) {
    if (!placed.has(draft.key)) {
      placed.add(draft.key)
      rows.push({ kind: 'draft', draft })
      appendDraftsAfter({ kind: 'draft', key: draft.key })
    }
  }
  return rows
}
