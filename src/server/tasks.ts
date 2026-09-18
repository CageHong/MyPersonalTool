import { asc, eq, sql, type SQL } from 'drizzle-orm'
import { db } from '../db'
import { task } from '../db/schema'

export type Task = typeof task.$inferSelect

export class ValidationError extends Error {
  readonly fields: Record<string, string>

  constructor(fields: Record<string, string>) {
    super('Validation failed')
    this.name = 'ValidationError'
    this.fields = fields
  }
}

export class NotFoundError extends Error {
  readonly id: number

  constructor(id: number) {
    super(`Task ${id} not found`)
    this.name = 'NotFoundError'
    this.id = id
  }
}

// id / createdAt / completedAt 不開放傳入
export type CreateTaskInput = {
  title: string
  notes?: string | null
  dueDate?: string | null
  dueTime?: string | null
  scheduledAt?: number | null
  durationMinutes?: number | null
  priority?: number | null
  parentTaskId?: number | null
}

// key 不存在 = 不改;值為 null = 設成 null。
// 完成狀態對外是布林值,存成 completedAt 只在這個檔案裡轉換;完成時間由伺服器寫入,不收 completedAt
export type UpdateTaskPatch = {
  title?: string
  notes?: string | null
  dueDate?: string | null
  dueTime?: string | null
  scheduledAt?: number | null
  durationMinutes?: number | null
  priority?: number | null
  parentTaskId?: number | null
  done?: boolean
}

const DUE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const DUE_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

// 無 / 低 / 中 / 高;刻意留空隙,之後插一級不動既有資料
const PRIORITY_VALUES: readonly number[] = [0, 1, 3, 5]

const UPDATABLE_KEYS = [
  'title',
  'notes',
  'dueDate',
  'dueTime',
  'scheduledAt',
  'durationMinutes',
  'priority',
  'parentTaskId',
] as const

function collectErrors(
  input: CreateTaskInput | UpdateTaskPatch,
  requireTitle: boolean,
): Record<string, string> {
  const fields: Record<string, string> = {}

  if (requireTitle || input.title !== undefined) {
    if (typeof input.title !== 'string' || input.title.trim() === '') {
      fields.title = 'required'
    }
  }

  if (input.dueDate != null) {
    if (typeof input.dueDate !== 'string' || !DUE_DATE_PATTERN.test(input.dueDate)) {
      fields.dueDate = 'invalid_format'
    }
  }

  if (input.dueTime != null) {
    if (typeof input.dueTime !== 'string' || !DUE_TIME_PATTERN.test(input.dueTime)) {
      fields.dueTime = 'invalid_format'
    }
  }

  // null 與 0 同義,寫入前才正規化
  if (input.priority != null && !PRIORITY_VALUES.includes(input.priority)) {
    fields.priority = 'invalid_value'
  }

  return fields
}

function assertValid(input: CreateTaskInput | UpdateTaskPatch, requireTitle: boolean): void {
  const fields = collectErrors(input, requireTitle)
  if (Object.keys(fields).length > 0) {
    throw new ValidationError(fields)
  }
}

export type TaskSort = 'default'

export type ListTasksOptions = {
  sort?: TaskSort
}

// 白名單:欄位名只能從這裡來,不從呼叫端的字串拼進 ORDER BY
const SORT_ORDERS: Record<TaskSort, SQL[]> = {
  // 未完成(0)在前,已完成(1)在後;同組內 createdAt 升冪,再以 id 打破平手
  default: [asc(sql`(${task.completedAt} is not null)`), asc(task.createdAt), asc(task.id)],
}

export function listTasks(options: ListTasksOptions = {}): Task[] {
  return db
    .select()
    .from(task)
    .orderBy(...SORT_ORDERS[options.sort ?? 'default'])
    .all()
}

export function createTask(input: CreateTaskInput): Task {
  assertValid(input, true)

  const [created] = db
    .insert(task)
    .values({
      title: input.title.trim(),
      notes: input.notes ?? null,
      dueDate: input.dueDate ?? null,
      dueTime: input.dueTime ?? null,
      scheduledAt: input.scheduledAt ?? null,
      durationMinutes: input.durationMinutes ?? null,
      priority: input.priority ?? 0,
      completedAt: null,
      createdAt: Math.floor(Date.now() / 1000),
      parentTaskId: input.parentTaskId ?? null,
    })
    .returning()
    .all()

  return created
}

export function updateTask(id: number, patch: UpdateTaskPatch): Task {
  const fields = collectErrors(patch, false)
  // 明確拒絕而不是忽略:呼叫端以為自己設了完成時間,其實沒有
  if ('completedAt' in patch) {
    fields.completedAt = 'invalid_value'
  }
  if (patch.done !== undefined && typeof patch.done !== 'boolean') {
    fields.done = 'invalid_value'
  }
  if (Object.keys(fields).length > 0) {
    throw new ValidationError(fields)
  }

  // 只挑白名單裡實際出現的 key,外來欄位不會漏進 SQL
  const normalized: Record<string, unknown> = {}
  for (const key of UPDATABLE_KEYS) {
    if (key in patch && patch[key] !== undefined) {
      normalized[key] = patch[key]
    }
  }
  if (typeof normalized.title === 'string') {
    normalized.title = normalized.title.trim()
  }
  // 欄位是 NOT NULL DEFAULT 0,null 在這裡正規化成 0
  if (normalized.priority === null) {
    normalized.priority = 0
  }

  return db.transaction((tx) => {
    const [existing] = tx.select().from(task).where(eq(task.id, id)).limit(1).all()
    if (!existing) {
      throw new NotFoundError(id)
    }

    // 只收集真的會改變的欄位:重複勾完成保留原本的完成時間,整個 patch 沒變就不寫入
    const updates: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(normalized)) {
      if (value !== existing[key as keyof Task]) {
        updates[key] = value
      }
    }
    if (patch.done === true && existing.completedAt === null) {
      updates.completedAt = Math.floor(Date.now() / 1000)
    }
    if (patch.done === false && existing.completedAt !== null) {
      updates.completedAt = null
    }

    if (Object.keys(updates).length === 0) {
      return existing
    }

    const [updated] = tx.update(task).set(updates).where(eq(task.id, id)).returning().all()
    return updated
  })
}

export function deleteTask(id: number): void {
  const [deleted] = db.delete(task).where(eq(task.id, id)).returning({ id: task.id }).all()
  if (!deleted) {
    throw new NotFoundError(id)
  }
}
