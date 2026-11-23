// 提醒與每日摘要的前端型別與純函式。前端不從 src/modules/tasks/server/ import 型別。

export type NotificationSummaryKind = 'morning' | 'afternoon' | 'evening'

export type NotificationSummarySetting = {
  time: string
  enabled: boolean
}

export type NotificationSettings = Record<NotificationSummaryKind, NotificationSummarySetting>

export const SUMMARY_ITEMS: { kind: NotificationSummaryKind; label: string }[] = [
  { kind: 'morning', label: '早上總覽' },
  { kind: 'afternoon', label: '習慣進度' },
  { kind: 'evening', label: '晚上收尾' },
]

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  morning: { time: '08:00', enabled: true },
  afternoon: { time: '15:00', enabled: true },
  evening: { time: '21:00', enabled: true },
}

export function areSummaryTimesInOrder(settings: NotificationSettings): boolean {
  return (
    settings.morning.time < settings.afternoon.time &&
    settings.afternoon.time < settings.evening.time
  )
}

export type ReminderKind = 'daily' | 'relative' | 'absolute'

export type ReminderItem = {
  id: number
  taskId: number | null
  ruleId: number | null
  habitId: number | null
  kind: ReminderKind
  daysBefore: number | null
  date: string | null
  time: string
}

export type ReminderInput =
  | { kind: 'daily'; time: string }
  | { kind: 'relative'; daysBefore: number; time: string }
  | { kind: 'absolute'; date: string; time: string }

export const MAX_REMINDERS = 5

export function formatReminderLabel(reminder: ReminderItem): string {
  if (reminder.kind === 'daily') {
    return `每天 ${reminder.time}`
  }
  if (reminder.kind === 'relative') {
    const days = reminder.daysBefore ?? 0
    return days === 0 ? `當天 ${reminder.time}` : `提前 ${days} 天 ${reminder.time}`
  }
  return `${reminder.date} ${reminder.time}`
}

export type UpcomingNotificationItem =
  | {
      kind: 'summary'
      date: string
      time: string
      summary: NotificationSummaryKind
      title: string
    }
  | {
      kind: 'habit'
      date: string
      time: string
      reminderId: number
      habitId: number
      title: string
    }
  | {
      kind: 'task'
      date: string
      time: string
      reminderId: number
      taskId: number | null
      ruleId: number | null
      title: string
    }
