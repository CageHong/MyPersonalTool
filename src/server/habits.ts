import { and, asc, desc, eq, isNull, max } from 'drizzle-orm'
import { db } from '../db'
import { habit, habitLog, habitPause, habitSettingsHistory } from '../db/schema'
import {
  PERIOD_TYPES,
  periodStart,
  progressOf,
  streakOf,
  type HabitProgress,
  type PeriodType,
} from '../lib/habit'
import { NotFoundError, ValidationError } from './errors'
import { isCalendarDate } from './validation'

export type Habit = typeof habit.$inferSelect
export type HabitLog = typeof habitLog.$inferSelect
export type HabitPause = typeof habitPause.$inferSelect

// 所有用到「今天」的函式都由參數接收 today(YYYY-MM-DD),不在這裡讀時鐘;
// 絕對時刻(createdAt)照其他模組的慣例用 now()

export type CreateHabitInput = {
  name: string
  periodType: PeriodType
  // 不給或 null = 紀錄型
  target?: number | null
}

// key 不存在 = 不改。periodType、target 有實際變動時追加一筆設定歷史;name 不進歷史
export type UpdateHabitPatch = {
  name?: string
  periodType?: PeriodType
  target?: number | null
}

export type HabitSummary = Habit & {
  paused: boolean
  // 當前週期的起始日
  periodStart: string
  progress: HabitProgress
  // 紀錄型為 null
  streak: number | null
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

function now(): number {
  return Math.floor(Date.now() / 1000)
}

function collectErrors(input: CreateHabitInput | UpdateHabitPatch, isCreate: boolean): Record<string, string> {
  const fields: Record<string, string> = {}
  if (isCreate || input.name !== undefined) {
    if (typeof input.name !== 'string' || input.name.trim() === '') {
      fields.name = 'required'
    }
  }
  if (isCreate || input.periodType !== undefined) {
    if (!PERIOD_TYPES.includes(input.periodType as PeriodType)) {
      fields.periodType = 'invalid_value'
    }
  }
  // 在這裡擋掉,不讓資料庫的 CHECK 失敗變成 500
  if (input.target != null && (!Number.isInteger(input.target) || input.target < 1)) {
    fields.target = 'invalid_value'
  }
  return fields
}

function assertValid(input: CreateHabitInput | UpdateHabitPatch, isCreate: boolean): void {
  const fields = collectErrors(input, isCreate)
  if (Object.keys(fields).length > 0) {
    throw new ValidationError(fields)
  }
}

function selectHabit(executor: typeof db | Tx, id: number): Habit {
  const [found] = executor.select().from(habit).where(eq(habit.id, id)).limit(1).all()
  if (!found) {
    throw new NotFoundError(id)
  }
  return found
}

function selectOpenPause(executor: typeof db | Tx, habitId: number): HabitPause | undefined {
  const [found] = executor
    .select()
    .from(habitPause)
    .where(and(eq(habitPause.habitId, habitId), isNull(habitPause.endDate)))
    .limit(1)
    .all()
  return found
}

export function createHabit(input: CreateHabitInput, today: string): Habit {
  assertValid(input, true)

  return db.transaction((tx) => {
    // 放在最後;不保證連號
    const [{ last }] = tx.select({ last: max(habit.sortOrder) }).from(habit).all()
    const [created] = tx
      .insert(habit)
      .values({
        name: input.name.trim(),
        periodType: input.periodType,
        target: input.target ?? null,
        sortOrder: (last ?? -1) + 1,
        createdAt: now(),
      })
      .returning()
      .all()
    // 設定歷史的第一筆:建立日也是 streak 的下限
    tx.insert(habitSettingsHistory)
      .values({
        habitId: created.id,
        periodType: created.periodType,
        target: created.target,
        effectiveFrom: today,
      })
      .run()
    return created
  })
}

export function updateHabit(id: number, patch: UpdateHabitPatch, today: string): Habit {
  assertValid(patch, false)

  return db.transaction((tx) => {
    const existing = selectHabit(tx, id)

    // 只收白名單裡實際出現、且真的會改變的欄位;整個 patch 沒變就不寫入
    const updates: Partial<Pick<Habit, 'name' | 'periodType' | 'target'>> = {}
    if (patch.name !== undefined && patch.name.trim() !== existing.name) {
      updates.name = patch.name.trim()
    }
    if (patch.periodType !== undefined && patch.periodType !== existing.periodType) {
      updates.periodType = patch.periodType
    }
    if (patch.target !== undefined && (patch.target ?? null) !== existing.target) {
      updates.target = patch.target ?? null
    }
    if (Object.keys(updates).length === 0) {
      return existing
    }

    const [updated] = tx.update(habit).set(updates).where(eq(habit.id, id)).returning().all()
    // habit 上的是現在設定的快取;歷史追加完整的一筆,不只記變動的欄位
    if (updates.periodType !== undefined || updates.target !== undefined) {
      tx.insert(habitSettingsHistory)
        .values({ habitId: id, periodType: updated.periodType, target: updated.target, effectiveFrom: today })
        .run()
    }
    return updated
  })
}

// 硬刪除(同 task);log、設定歷史、停止區間由外鍵 cascade 一起刪。要保留紀錄請用停止
export function deleteHabit(id: number): void {
  const [deleted] = db.delete(habit).where(eq(habit.id, id)).returning({ id: habit.id }).all()
  if (!deleted) {
    throw new NotFoundError(id)
  }
}

export function addLog(habitId: number, date: string, today: string): HabitLog {
  if (!isCalendarDate(date)) {
    throw new ValidationError({ date: 'invalid_format' })
  }
  // 進度依日期分組計數,未來的 log 會算進當前週期。過去的日期允許(補登)
  if (date > today) {
    throw new ValidationError({ date: 'invalid_value' })
  }

  return db.transaction((tx) => {
    selectHabit(tx, habitId)
    if (selectOpenPause(tx, habitId)) {
      throw new ValidationError({ state: 'paused' })
    }
    const [created] = tx.insert(habitLog).values({ habitId, date, createdAt: now() }).returning().all()
    return created
  })
}

// 刪除該日期最新的一列(撤銷最近一次)
export function removeLog(habitId: number, date: string): void {
  if (!isCalendarDate(date)) {
    throw new ValidationError({ date: 'invalid_format' })
  }

  db.transaction((tx) => {
    selectHabit(tx, habitId)
    const [latest] = tx
      .select({ id: habitLog.id })
      .from(habitLog)
      .where(and(eq(habitLog.habitId, habitId), eq(habitLog.date, date)))
      .orderBy(desc(habitLog.id))
      .limit(1)
      .all()
    if (!latest) {
      throw new ValidationError({ date: 'no_log' })
    }
    tx.delete(habitLog).where(eq(habitLog.id, latest.id)).run()
  })
}

// 停止不建新實體:寫一段 endDate 為 null 的區間。已停止時拒絕,不冪等:重複停止多半是畫面過期
export function pauseHabit(id: number, today: string): HabitPause {
  return db.transaction((tx) => {
    selectHabit(tx, id)
    if (selectOpenPause(tx, id)) {
      throw new ValidationError({ state: 'already_paused' })
    }
    const [created] = tx.insert(habitPause).values({ habitId: id, startDate: today, endDate: null }).returning().all()
    return created
  })
}

// endDate 含當天:恢復當天所屬的週期與停止區間有交集,照規則跳過
export function resumeHabit(id: number, today: string): HabitPause {
  return db.transaction((tx) => {
    selectHabit(tx, id)
    const open = selectOpenPause(tx, id)
    if (!open) {
      throw new ValidationError({ state: 'not_paused' })
    }
    const [updated] = tx
      .update(habitPause)
      .set({ endDate: today })
      .where(eq(habitPause.id, open.id))
      .returning()
      .all()
    return updated
  })
}

function groupByHabit<T extends { habitId: number }>(rows: T[]): Map<number, T[]> {
  const groups = new Map<number, T[]>()
  for (const row of rows) {
    const group = groups.get(row.habitId)
    if (group) {
      group.push(row)
    } else {
      groups.set(row.habitId, [row])
    }
  }
  return groups
}

// 每次都從 log 與設定歷史重算;變慢時再物化週期結論(decisions §8)
export function listHabits(today: string): HabitSummary[] {
  const habits = db.select().from(habit).orderBy(asc(habit.sortOrder), asc(habit.id)).all()
  const logs = groupByHabit(db.select().from(habitLog).all())
  const history = groupByHabit(db.select().from(habitSettingsHistory).all())
  const pauses = groupByHabit(db.select().from(habitPause).all())

  return habits.map((row) => {
    const habitLogs = logs.get(row.id) ?? []
    const habitPauses = pauses.get(row.id) ?? []
    const start = periodStart(today, row.periodType)
    return {
      ...row,
      paused: habitPauses.some((pause) => pause.endDate === null),
      periodStart: start,
      progress: progressOf(habitLogs, row, start),
      streak: streakOf({
        logs: habitLogs,
        settingsHistory: history.get(row.id) ?? [],
        pauses: habitPauses,
        today,
        // 豁免(點數購買凍結)接積分系統時才有
        exempt: [],
      }),
    }
  })
}
