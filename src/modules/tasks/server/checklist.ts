import { and, asc, eq, isNull, max } from 'drizzle-orm'
import { db } from '../db'
import { task, taskChecklistItem } from '../db/schema'
import { BULK_MAX_LINES } from '../lib/bulk'
import { NotFoundError, ValidationError } from './tasks'

export type ChecklistItem = typeof taskChecklistItem.$inferSelect

// key 不存在 = 不改。完成狀態對外是布林值,存成 completedAt 只在這個檔案裡轉換
export type UpdateChecklistItemPatch = {
  title?: string
  done?: boolean
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

function now(): number {
  return Math.floor(Date.now() / 1000)
}

function markTaskEdited(tx: Tx, taskId: number, timestamp: number): void {
  tx.update(task).set({ editedAt: timestamp }).where(eq(task.id, taskId)).run()
}

function assertLiveTaskExists(executor: typeof db | Tx, taskId: number): void {
  const [found] = executor
    .select({ id: task.id })
    .from(task)
    .where(and(eq(task.id, taskId), isNull(task.deletedAt)))
    .limit(1)
    .all()
  if (!found) {
    throw new NotFoundError(taskId)
  }
}

// 查詢 checklist 例外允許垃圾桶內的任務:右欄要唯讀顯示(decisions §6h)
function assertAnyTaskExists(executor: typeof db | Tx, taskId: number): void {
  const [found] = executor
    .select({ id: task.id })
    .from(task)
    .where(eq(task.id, taskId))
    .limit(1)
    .all()
  if (!found) {
    throw new NotFoundError(taskId)
  }
}

function selectItems(executor: typeof db | Tx, taskId: number): ChecklistItem[] {
  return executor
    .select()
    .from(taskChecklistItem)
    .where(eq(taskChecklistItem.taskId, taskId))
    // position 不保證唯一,id 打破平手
    .orderBy(asc(taskChecklistItem.position), asc(taskChecklistItem.id))
    .all()
}

function assertTitle(title: unknown): asserts title is string {
  if (typeof title !== 'string' || title.trim() === '') {
    throw new ValidationError({ title: 'required' })
  }
}

export function listChecklistItems(taskId: number): ChecklistItem[] {
  assertAnyTaskExists(db, taskId)
  return selectItems(db, taskId)
}

export function createChecklistItem(taskId: number, title: string): ChecklistItem {
  assertTitle(title)

  // 查任務與取最大 position 放在同一個 transaction,新項目才一定排在最後
  return db.transaction((tx) => {
    // 先查,不讓外鍵錯誤變成 500
    assertLiveTaskExists(tx, taskId)

    const [{ last }] = tx
      .select({ last: max(taskChecklistItem.position) })
      .from(taskChecklistItem)
      .where(eq(taskChecklistItem.taskId, taskId))
      .all()

    const timestamp = now()
    const [created] = tx
      .insert(taskChecklistItem)
      .values({
        taskId,
        title: title.trim(),
        position: last === null ? 0 : last + 1,
        completedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .returning()
      .all()

    markTaskEdited(tx, taskId, timestamp)
    return created
  })
}

// 批次貼上:整批放在最後,照陣列順序;一個 transaction,全部建立或全部不寫入(decisions §6f)
export function createChecklistItems(taskId: number, titles: string[]): ChecklistItem[] {
  if (!Array.isArray(titles) || titles.length === 0) {
    throw new ValidationError({ titles: 'required' })
  }
  if (titles.length > BULK_MAX_LINES) {
    throw new ValidationError({ titles: 'too_many' })
  }
  const fields: Record<string, string> = {}
  titles.forEach((title, index) => {
    if (typeof title !== 'string' || title.trim() === '') {
      fields[`${index}.title`] = 'required'
    }
  })
  if (Object.keys(fields).length > 0) {
    throw new ValidationError(fields)
  }

  return db.transaction((tx) => {
    assertLiveTaskExists(tx, taskId)

    const [{ last }] = tx
      .select({ last: max(taskChecklistItem.position) })
      .from(taskChecklistItem)
      .where(eq(taskChecklistItem.taskId, taskId))
      .all()
    const start = last === null ? 0 : last + 1

    const timestamp = now()
    const createdItems = titles.map((title, index) => {
      const [created] = tx
        .insert(taskChecklistItem)
        .values({
          taskId,
          title: title.trim(),
          position: start + index,
          completedAt: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .returning()
        .all()
      return created
    })
    markTaskEdited(tx, taskId, timestamp)
    return createdItems
  })
}

export function updateChecklistItem(id: number, patch: UpdateChecklistItemPatch): ChecklistItem {
  if (patch.title !== undefined) {
    assertTitle(patch.title)
  }
  if (patch.done !== undefined && typeof patch.done !== 'boolean') {
    throw new ValidationError({ done: 'invalid_value' })
  }

  return db.transaction((tx) => {
    const [existing] = tx
      .select()
      .from(taskChecklistItem)
      .where(eq(taskChecklistItem.id, id))
      .limit(1)
      .all()
    if (!existing) {
      throw new NotFoundError(id)
    }
    assertLiveTaskExists(tx, existing.taskId)

    // 只收集真的會改變的欄位:重複勾選保留原本的完成時間,值沒變就不動 updatedAt
    const updates: Partial<Pick<ChecklistItem, 'title' | 'completedAt'>> = {}
    if (patch.title !== undefined && patch.title.trim() !== existing.title) {
      updates.title = patch.title.trim()
    }
    if (patch.done === true && existing.completedAt === null) {
      updates.completedAt = now()
    }
    if (patch.done === false && existing.completedAt !== null) {
      updates.completedAt = null
    }

    if (Object.keys(updates).length === 0) {
      return existing
    }

    // 全部勾完也不動任務本身的 completedAt:checklist 是任務的內容,不是它的完成條件
    const timestamp = now()
    const [updated] = tx
      .update(taskChecklistItem)
      .set({ ...updates, updatedAt: timestamp })
      .where(eq(taskChecklistItem.id, id))
      .returning()
      .all()
    markTaskEdited(tx, existing.taskId, timestamp)
    return updated
  })
}

// 其餘項目的 position 不重編,留下空號不影響排序
export function deleteChecklistItem(id: number): void {
  db.transaction((tx) => {
    const [existing] = tx
      .select({ id: taskChecklistItem.id, taskId: taskChecklistItem.taskId })
      .from(taskChecklistItem)
      .where(eq(taskChecklistItem.id, id))
      .limit(1)
      .all()
    if (!existing) {
      throw new NotFoundError(id)
    }
    assertLiveTaskExists(tx, existing.taskId)
    tx.delete(taskChecklistItem).where(eq(taskChecklistItem.id, id)).run()
    markTaskEdited(tx, existing.taskId, now())
  })
}

// itemIds 必須恰好是這個任務現有的全部項目:不能缺、不能多、不能重複。
// 順序是清單的屬性,不是項目內容,所以不動 updatedAt
export function reorderChecklistItems(taskId: number, itemIds: number[]): ChecklistItem[] {
  return db.transaction((tx) => {
    assertLiveTaskExists(tx, taskId)

    const currentIds = new Set(selectItems(tx, taskId).map((item) => item.id))
    const matches =
      Array.isArray(itemIds) &&
      itemIds.every((itemId) => Number.isInteger(itemId)) &&
      itemIds.length === currentIds.size &&
      new Set(itemIds).size === itemIds.length &&
      itemIds.every((itemId) => currentIds.has(itemId))
    if (!matches) {
      // throw 讓 transaction 回滾;這之前沒有任何寫入
      throw new ValidationError({ itemIds: 'mismatch' })
    }

    itemIds.forEach((itemId, position) => {
      tx.update(taskChecklistItem)
        .set({ position })
        .where(eq(taskChecklistItem.id, itemId))
        .run()
    })

    markTaskEdited(tx, taskId, now())
    return selectItems(tx, taskId)
  })
}
