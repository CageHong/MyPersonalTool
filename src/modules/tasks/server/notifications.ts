import { asc, eq } from 'drizzle-orm'
import { localDate, localTime } from '@/platform/date'
import { db } from '../db'
import { taskNotificationSent, taskNotificationSetting, taskReminder } from '../db/schema'
import { addDays, diffDays } from '../lib/date'
import { periodEnd } from '../lib/habit'
import { collapseRecurring, filterTasks } from '../lib/views'
import { ValidationError } from './errors'
import { listHabits, type HabitSummary } from './habits'
import type { Reminder } from './reminders'
import { listTasks, type Task } from './tasks'
import { isCalendarDate, isTimeOfDay } from './validation'

export type TaskDueNotification = {
  key: string
  message: {
    title: string
    body: string
  }
}

export type NotificationSummaryKind = 'morning' | 'afternoon' | 'evening'

export type NotificationSummarySetting = {
  time: string
  enabled: boolean
}

export type NotificationSettings = Record<NotificationSummaryKind, NotificationSummarySetting>

const SUMMARY_KINDS: readonly NotificationSummaryKind[] = ['morning', 'afternoon', 'evening']

const DEFAULT_SETTINGS: NotificationSettings = {
  morning: { time: '08:00', enabled: true },
  afternoon: { time: '15:00', enabled: true },
  evening: { time: '21:00', enabled: true },
}

const SUMMARY_TITLES: Record<NotificationSummaryKind, string> = {
  morning: '早上總覽',
  afternoon: '習慣進度',
  evening: '晚上收尾',
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function getNotificationSettings(): NotificationSettings {
  const rows = db.select().from(taskNotificationSetting).all()
  const result: NotificationSettings = {
    morning: { ...DEFAULT_SETTINGS.morning },
    afternoon: { ...DEFAULT_SETTINGS.afternoon },
    evening: { ...DEFAULT_SETTINGS.evening },
  }
  for (const row of rows) {
    result[row.kind] = { time: row.time, enabled: row.enabled }
  }
  return result
}

export function saveNotificationSettings(input: NotificationSettings): NotificationSettings {
  const fields: Record<string, string> = {}

  if (!isPlainObject(input)) {
    throw new ValidationError({ body: 'invalid_value' })
  }

  for (const kind of SUMMARY_KINDS) {
    const entry = (input as Record<string, unknown>)[kind]
    if (!isPlainObject(entry) || !isTimeOfDay(entry.time) || typeof entry.enabled !== 'boolean') {
      fields[kind] = 'invalid_value'
    }
  }

  if (Object.keys(fields).length === 0) {
    if (!(input.morning.time < input.afternoon.time && input.afternoon.time < input.evening.time)) {
      fields.times = 'out_of_order'
    }
  }

  if (Object.keys(fields).length > 0) {
    throw new ValidationError(fields)
  }

  const timestamp = nowSeconds()
  db.transaction((tx) => {
    for (const kind of SUMMARY_KINDS) {
      const { time, enabled } = input[kind]
      tx.insert(taskNotificationSetting)
        .values({ kind, time, enabled, updatedAt: timestamp })
        .onConflictDoUpdate({
          target: taskNotificationSetting.kind,
          set: { time, enabled, updatedAt: timestamp },
        })
        .run()
    }
  })

  return getNotificationSettings()
}

function parseRunnerKey(runnerKey: string): { key: string; date: string } {
  const atIndex = runnerKey.lastIndexOf('@')
  if (atIndex <= 0 || atIndex === runnerKey.length - 1) {
    throw new Error(`Invalid notification key: ${runnerKey}`)
  }
  const key = runnerKey.slice(0, atIndex)
  const date = runnerKey.slice(atIndex + 1)
  if (!isCalendarDate(date)) {
    throw new Error(`Invalid notification key date: ${runnerKey}`)
  }
  return { key, date }
}

export function markTaskNotificationsSent(keys: string[]): void {
  if (keys.length === 0) {
    return
  }

  const parsed = keys.map(parseRunnerKey)
  const timestamp = nowSeconds()

  db.transaction((tx) => {
    for (const { key, date } of parsed) {
      tx.insert(taskNotificationSent)
        .values({ key, date, sentAt: timestamp })
        .onConflictDoNothing({ target: [taskNotificationSent.key, taskNotificationSent.date] })
        .run()
    }
  })
}

function formatTaskLines(tasks: readonly { title: string; dueDate: string | null }[], today: string): string[] {
  return tasks.map((item) => {
    const overdue = item.dueDate !== null && item.dueDate < today ? '(逾期)' : ''
    return `- ${item.title}${overdue}`
  })
}

function formatHabitLine(habit: HabitSummary): string {
  return `- ${habit.name} ${habit.progress.count}/${habit.target}`
}

function buildSummaryBody(
  kind: NotificationSummaryKind,
  todayTasks: readonly { title: string; dueDate: string | null }[],
  highPriorityTasks: readonly { title: string }[],
  habits: HabitSummary[],
  today: string,
): string {
  const activeTargeted = habits.filter((h) => !h.paused && h.target !== null)
  const sections: string[] = []

  if (kind === 'morning') {
    if (todayTasks.length > 0) {
      sections.push('任務', ...formatTaskLines(todayTasks, today))
    }
    if (highPriorityTasks.length > 0) {
      sections.push('高優先', ...highPriorityTasks.map((item) => `- ${item.title}`))
    }
    if (activeTargeted.length > 0) {
      sections.push('習慣', ...activeTargeted.map(formatHabitLine))
    }
    return sections.join('\n')
  }

  if (kind === 'afternoon') {
    const done = activeTargeted.filter((h) => h.progress.achieved)
    const notDone = activeTargeted.filter((h) => !h.progress.achieved)
    if (done.length > 0) {
      sections.push('已完成', ...done.map(formatHabitLine))
    }
    if (notDone.length > 0) {
      sections.push('未完成', ...notDone.map(formatHabitLine))
    }
    return sections.join('\n')
  }

  // evening
  if (todayTasks.length > 0) {
    sections.push('任務', ...formatTaskLines(todayTasks, today))
  }
  const endingToday = activeTargeted.filter(
    (h) => !h.progress.achieved && periodEnd(h.periodStart, h.periodType) === today,
  )
  if (endingToday.length > 0) {
    sections.push('習慣', ...endingToday.map(formatHabitLine))
  }
  return sections.join('\n')
}

function formatTaskReminderBody(t: Task, today: string): string {
  if (t.dueDate === null) {
    return t.title
  }
  const days = diffDays(today, t.dueDate)
  if (days < 0) {
    return `${t.title}(逾期)`
  }
  if (days === 0) {
    return `${t.title}(今天到期)`
  }
  if (days === 1) {
    return `${t.title}(明天到期)`
  }
  return `${t.title}(${days} 天後到期)`
}

function evaluateTaskReminder(
  reminder: Reminder,
  t: Task,
  today: string,
  sentSet: Set<string>,
  autoMarkKeys: string[],
  due: TaskDueNotification[],
): void {
  const baseKey = `reminder:${reminder.id}:${t.id}:${reminder.time}`
  if (sentSet.has(baseKey)) {
    return
  }
  const runnerKey = `${baseKey}@${today}`
  if (t.completedAt !== null) {
    autoMarkKeys.push(runnerKey)
    return
  }
  due.push({
    key: runnerKey,
    message: {
      title: '任務提醒',
      body: formatTaskReminderBody(t, today),
    },
  })
}

export function dueTaskNotifications(now: Date): TaskDueNotification[] {
  const today = localDate(now)
  const currentTime = localTime(now)
  const settings = getNotificationSettings()

  const sentRows = db
    .select({ key: taskNotificationSent.key })
    .from(taskNotificationSent)
    .where(eq(taskNotificationSent.date, today))
    .all()
  const sentSet = new Set(sentRows.map((row) => row.key))

  const allTasks = listTasks({ today })
  const taskById = new Map(allTasks.map((t) => [t.id, t]))
  const collapsedTasks = collapseRecurring(allTasks, today).tasks
  const todayTasks = filterTasks(allTasks, 'today', today).tasks.filter(
    (t) => !taskById.get(t.id)!.excludeFromSummary,
  )
  const highPriorityTasks = collapsedTasks.filter(
    (t) =>
      t.completedAt === null &&
      t.priority === 5 &&
      !taskById.get(t.id)!.excludeFromSummary &&
      (t.dueDate === null || t.dueDate > today),
  )
  const habits = listHabits(today)
  const summaryHabits = habits.filter((h) => !h.excludeFromSummary)

  const due: TaskDueNotification[] = []
  const autoMarkKeys: string[] = []

  for (let i = 0; i < SUMMARY_KINDS.length; i += 1) {
    const kind = SUMMARY_KINDS[i]
    const setting = settings[kind]
    const baseKey = `summary:${kind}`

    if (!setting.enabled || sentSet.has(baseKey) || currentTime < setting.time) {
      continue
    }

    const nextEnabledKind = SUMMARY_KINDS.slice(i + 1).find((k) => settings[k].enabled)
    if (nextEnabledKind !== undefined && currentTime >= settings[nextEnabledKind].time) {
      continue
    }

    const body = buildSummaryBody(kind, todayTasks, highPriorityTasks, summaryHabits, today)
    const runnerKey = `${baseKey}@${today}`
    if (!body) {
      autoMarkKeys.push(runnerKey)
      continue
    }

    due.push({
      key: runnerKey,
      message: {
        title: SUMMARY_TITLES[kind],
        body,
      },
    })
  }

  const reminders = db
    .select()
    .from(taskReminder)
    .orderBy(asc(taskReminder.time), asc(taskReminder.id))
    .all()
  const habitById = new Map(habits.map((h) => [h.id, h]))
  const tasksByRuleId = new Map<number, Task[]>()
  for (const t of allTasks) {
    if (t.recurrenceRuleId !== null) {
      const list = tasksByRuleId.get(t.recurrenceRuleId)
      if (list) {
        list.push(t)
      } else {
        tasksByRuleId.set(t.recurrenceRuleId, [t])
      }
    }
  }

  for (const r of reminders) {
    if (currentTime < r.time) {
      continue
    }

    if (r.habitId !== null) {
      const h = habitById.get(r.habitId)
      if (!h || h.paused) {
        continue
      }
      const baseKey = `reminder:${r.id}:${r.time}`
      if (sentSet.has(baseKey)) {
        continue
      }
      const runnerKey = `${baseKey}@${today}`
      if (h.target !== null && h.progress.achieved) {
        autoMarkKeys.push(runnerKey)
        continue
      }
      const body = h.target === null ? h.name : `${h.name} ${h.progress.count}/${h.target}`
      due.push({
        key: runnerKey,
        message: {
          title: '習慣提醒',
          body,
        },
      })
    } else if (r.taskId !== null) {
      const t = taskById.get(r.taskId)
      if (!t) {
        continue
      }
      const isDueToday =
        r.kind === 'absolute'
          ? r.date === today
          : t.dueDate !== null && addDays(t.dueDate, -r.daysBefore!) === today
      if (!isDueToday) {
        continue
      }
      evaluateTaskReminder(r, t, today, sentSet, autoMarkKeys, due)
    } else if (r.ruleId !== null) {
      const instances = tasksByRuleId.get(r.ruleId) ?? []
      for (const t of instances) {
        if (t.dueDate === null || addDays(t.dueDate, -r.daysBefore!) !== today) {
          continue
        }
        evaluateTaskReminder(r, t, today, sentSet, autoMarkKeys, due)
      }
    }
  }

  if (autoMarkKeys.length > 0) {
    markTaskNotificationsSent(autoMarkKeys)
  }

  return due
}
