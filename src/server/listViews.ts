import { asc } from 'drizzle-orm'
import { db } from '../db'
import { taskListView } from '../db/schema'
import {
  GROUP_BY_VALUES,
  isListKey,
  SORT_BY_VALUES,
  SORT_DIRECTION_VALUES,
  type ViewSettings,
} from '../lib/listView'
import { ValidationError } from './errors'

export type ListViewSettings = typeof taskListView.$inferSelect

// 只回傳存過的清單;沒有列的清單由呼叫端套預設值(src/lib/listView.ts 的 defaultSettings)。
// 預設值不落地:之後改預設時,沒動過設定的清單會跟著變
export function listViewSettings(): ListViewSettings[] {
  return db.select().from(taskListView).orderBy(asc(taskListView.listKey)).all()
}

function includes(values: readonly string[], value: unknown): boolean {
  return typeof value === 'string' && values.includes(value)
}

// 整份替換(upsert):三個欄位都要給。重複送同一份結果相同
export function saveViewSettings(listKey: string, input: ViewSettings): ListViewSettings {
  const fields: Record<string, string> = {}
  if (!isListKey(listKey)) {
    fields.listKey = 'invalid_value'
  }
  if (!includes(GROUP_BY_VALUES, input?.groupBy)) {
    fields.groupBy = 'invalid_value'
  }
  if (!includes(SORT_BY_VALUES, input?.sortBy)) {
    fields.sortBy = 'invalid_value'
  }
  if (!includes(SORT_DIRECTION_VALUES, input?.sortDirection)) {
    fields.sortDirection = 'invalid_value'
  }
  if (Object.keys(fields).length > 0) {
    throw new ValidationError(fields)
  }

  const values = {
    groupBy: input.groupBy,
    sortBy: input.sortBy,
    sortDirection: input.sortDirection,
    updatedAt: Math.floor(Date.now() / 1000),
  }
  const [saved] = db
    .insert(taskListView)
    .values({ listKey, ...values })
    .onConflictDoUpdate({ target: taskListView.listKey, set: values })
    .returning()
    .all()
  return saved
}
