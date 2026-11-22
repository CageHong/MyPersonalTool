import { asc, count, eq } from 'drizzle-orm'
import { localDate, localTime } from '@/platform/date'
import { db } from '../db'
import { habit, task, taskRecurrenceRule, taskReminder } from '../db/schema'
import { NotFoundError, ValidationError } from './errors'
import { isCalendarDate, isTimeOfDay } from './validation'

export type Reminder = typeof taskReminder.$inferSelect

export type ReminderOwner = { taskId: number } | { ruleId: number } | { habitId: number }

export type ReminderInput =
  | { kind: 'daily'; time: string }
  | { kind: 'relative'; daysBefore: number; time: string }
  | { kind: 'absolute'; date: string; time: string }

export const MAX_REMINDERS_PER_OWNER = 5

type OwnerKind = 'task' | 'rule' | 'habit'
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

function resolveOwner(owner: ReminderOwner): { kind: OwnerKind; id: number } {
  if ('taskId' in owner) {
    return { kind: 'task', id: owner.taskId }
  }
  if ('ruleId' in owner) {
    return { kind: 'rule', id: owner.ruleId }
  }
  return { kind: 'habit', id: owner.habitId }
}

function ownerColumn(kind: OwnerKind) {
  switch (kind) {
    case 'task':
      return taskReminder.taskId
    case 'rule':
      return taskReminder.ruleId
    case 'habit':
      return taskReminder.habitId
  }
}

function assertOwnerExists(executor: typeof db | Tx, kind: OwnerKind, id: number): void {
  const table = kind === 'task' ? task : kind === 'rule' ? taskRecurrenceRule : habit
  const [found] = executor.select({ id: table.id }).from(table).where(eq(table.id, id)).limit(1).all()
  if (!found) {
    throw new NotFoundError(id)
  }
}

const ALLOWED_KINDS: Record<OwnerKind, readonly ReminderInput['kind'][]> = {
  habit: ['daily'],
  task: ['relative', 'absolute'],
  rule: ['relative'],
}

function validateInput(ownerKind: OwnerKind, input: ReminderInput, now: Date): void {
  const fields: Record<string, string> = {}

  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new ValidationError({ kind: 'invalid_value' })
  }

  if (!ALLOWED_KINDS[ownerKind].includes(input.kind)) {
    fields.kind = 'invalid_value'
  }

  if (!isTimeOfDay(input.time)) {
    fields.time = 'invalid_value'
  }

  if (input.kind === 'relative') {
    const maxDays = ownerKind === 'rule' ? 6 : 28
    if (!Number.isInteger(input.daysBefore) || input.daysBefore < 0 || input.daysBefore > maxDays) {
      fields.daysBefore = 'invalid_value'
    }
  } else if (input.kind === 'absolute') {
    if (!isCalendarDate(input.date)) {
      fields.date = 'invalid_format'
    } else {
      const today = localDate(now)
      const currentTime = localTime(now)
      if (input.date < today || (input.date === today && isTimeOfDay(input.time) && input.time < currentTime)) {
        fields.date = 'in_past'
      }
    }
  }

  if (Object.keys(fields).length > 0) {
    throw new ValidationError(fields)
  }
}

export function listReminders(owner: ReminderOwner): Reminder[] {
  const { kind, id } = resolveOwner(owner)
  assertOwnerExists(db, kind, id)
  return db
    .select()
    .from(taskReminder)
    .where(eq(ownerColumn(kind), id))
    .orderBy(asc(taskReminder.id))
    .all()
}

export function createReminder(owner: ReminderOwner, input: ReminderInput, now: Date): Reminder {
  const { kind: ownerKind, id } = resolveOwner(owner)

  return db.transaction((tx) => {
    assertOwnerExists(tx, ownerKind, id)
    validateInput(ownerKind, input, now)

    const [{ existingCount }] = tx
      .select({ existingCount: count() })
      .from(taskReminder)
      .where(eq(ownerColumn(ownerKind), id))
      .all()
    if (existingCount >= MAX_REMINDERS_PER_OWNER) {
      throw new ValidationError({ reminders: 'too_many' })
    }

    const timestamp = nowSeconds()
    const [created] = tx
      .insert(taskReminder)
      .values({
        taskId: ownerKind === 'task' ? id : null,
        ruleId: ownerKind === 'rule' ? id : null,
        habitId: ownerKind === 'habit' ? id : null,
        kind: input.kind,
        time: input.time,
        daysBefore: input.kind === 'relative' ? input.daysBefore : null,
        date: input.kind === 'absolute' ? input.date : null,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .returning()
      .all()
    return created
  })
}

export function updateReminder(id: number, input: ReminderInput, now: Date): Reminder {
  return db.transaction((tx) => {
    const [existing] = tx.select().from(taskReminder).where(eq(taskReminder.id, id)).limit(1).all()
    if (!existing) {
      throw new NotFoundError(id)
    }

    const ownerKind: OwnerKind =
      existing.taskId !== null ? 'task' : existing.ruleId !== null ? 'rule' : 'habit'
    validateInput(ownerKind, input, now)

    const [updated] = tx
      .update(taskReminder)
      .set({
        kind: input.kind,
        time: input.time,
        daysBefore: input.kind === 'relative' ? input.daysBefore : null,
        date: input.kind === 'absolute' ? input.date : null,
        updatedAt: nowSeconds(),
      })
      .where(eq(taskReminder.id, id))
      .returning()
      .all()
    return updated
  })
}

export function deleteReminder(id: number): void {
  const [deleted] = db.delete(taskReminder).where(eq(taskReminder.id, id)).returning({ id: taskReminder.id }).all()
  if (!deleted) {
    throw new NotFoundError(id)
  }
}
