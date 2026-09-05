import { eq } from 'drizzle-orm'
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
  priority?: number
  parentTaskId?: number | null
}

// key 不存在 = 不改;值為 null = 設成 null
export type UpdateTaskPatch = {
  title?: string
  notes?: string | null
  dueDate?: string | null
  dueTime?: string | null
  scheduledAt?: number | null
  durationMinutes?: number | null
  priority?: number
  completedAt?: number | null
  parentTaskId?: number | null
}

const DUE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const DUE_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

const UPDATABLE_KEYS = [
  'title',
  'notes',
  'dueDate',
  'dueTime',
  'scheduledAt',
  'durationMinutes',
  'priority',
  'completedAt',
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

  if (input.priority !== undefined && !Number.isInteger(input.priority)) {
    fields.priority = 'must_be_integer'
  }

  return fields
}

function assertValid(input: CreateTaskInput | UpdateTaskPatch, requireTitle: boolean): void {
  const fields = collectErrors(input, requireTitle)
  if (Object.keys(fields).length > 0) {
    throw new ValidationError(fields)
  }
}

export function listTasks(): Task[] {
  return db.select().from(task).all()
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
  assertValid(patch, false)

  // 只挑白名單裡實際出現的 key,外來欄位不會漏進 SQL
  const updates: Record<string, unknown> = {}
  for (const key of UPDATABLE_KEYS) {
    if (key in patch && patch[key] !== undefined) {
      updates[key] = patch[key]
    }
  }
  if (typeof updates.title === 'string') {
    updates.title = updates.title.trim()
  }

  if (Object.keys(updates).length === 0) {
    const [existing] = db.select().from(task).where(eq(task.id, id)).limit(1).all()
    if (!existing) {
      throw new NotFoundError(id)
    }
    return existing
  }

  const [updated] = db.update(task).set(updates).where(eq(task.id, id)).returning().all()
  if (!updated) {
    throw new NotFoundError(id)
  }
  return updated
}

export function deleteTask(id: number): void {
  const [deleted] = db.delete(task).where(eq(task.id, id)).returning({ id: task.id }).all()
  if (!deleted) {
    throw new NotFoundError(id)
  }
}
