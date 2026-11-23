import { useRef, useState, type ReactNode } from 'react'
import TaskListSkeleton from './TaskListSkeleton'
import type { ApiError } from '@/modules/tasks/lib/errors'
import type { HabitItem } from '@/modules/tasks/lib/habitView'
import type { RecurrenceRuleView } from '@/modules/tasks/lib/recurrence'
import {
  areSummaryTimesInOrder,
  SUMMARY_ITEMS,
  type NotificationSettings,
  type NotificationSummaryKind,
  type NotificationSummarySetting,
  type UpcomingNotificationItem,
} from '@/modules/tasks/lib/reminders'
import type { Task } from '@/modules/tasks/lib/tasks'
import { earliestIncomplete, type ViewId } from '@/modules/tasks/lib/views'
import styles from './RemindersView.module.css'

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/

function allTimesValid(settings: NotificationSettings): boolean {
  return (
    TIME_PATTERN.test(settings.morning.time) &&
    TIME_PATTERN.test(settings.afternoon.time) &&
    TIME_PATTERN.test(settings.evening.time)
  )
}

type Props = {
  settings: NotificationSettings
  upcoming: UpcomingNotificationItem[]
  tasks: Task[]
  rules: RecurrenceRuleView[]
  habits: HabitItem[]
  today: string
  loading: boolean
  error: string | null
  onSaveSettings: (next: NotificationSettings) => Promise<ApiError | null>
  onOpenTask: (taskId: number, targetView?: ViewId) => void
  onOpenHabit: (habitId: number) => void
  leftToggle?: ReactNode
  rightToggle?: ReactNode
}

export default function RemindersView({
  settings,
  upcoming,
  tasks,
  rules,
  habits,
  today,
  loading,
  error,
  onSaveSettings,
  onOpenTask,
  onOpenHabit,
  leftToggle,
  rightToggle,
}: Props) {
  const [overrideSettings, setOverrideSettings] = useState<NotificationSettings | null>(null)
  const [outOfOrder, setOutOfOrder] = useState(false)
  const saveGenerationRef = useRef(0)

  const displaySettings = overrideSettings ?? settings

  function updateSummary(
    kind: NotificationSummaryKind,
    patch: Partial<NotificationSummarySetting>,
  ) {
    const next: NotificationSettings = {
      ...displaySettings,
      [kind]: {
        ...displaySettings[kind],
        ...patch,
      },
    }
    setOverrideSettings(next)

    if (!allTimesValid(next)) {
      return
    }

    if (!areSummaryTimesInOrder(next)) {
      setOutOfOrder(true)
      return
    }

    setOutOfOrder(false)
    saveGenerationRef.current += 1
    const generation = saveGenerationRef.current
    void onSaveSettings(next).then((failure) => {
      if (failure === null && saveGenerationRef.current === generation) {
        setOverrideSettings(null)
      }
    })
  }

  const excludedTasks = tasks.filter(
    (task) => task.recurrenceRuleId === null && Boolean(task.excludeFromSummary),
  )
  const excludedRules = rules.filter((rule) => Boolean(rule.excludeFromSummary))
  const excludedHabits = habits.filter((habit) => Boolean(habit.excludeFromSummary))
  const hasExcluded =
    excludedTasks.length > 0 || excludedRules.length > 0 || excludedHabits.length > 0

  return (
    <div className={styles.container}>
      <header className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          {leftToggle}
          <h2 className={styles.viewTitle}>提醒</h2>
        </div>
        <div className={styles.toolbarRight}>{rightToggle}</div>
      </header>

      {error !== null && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <TaskListSkeleton />
      ) : (
        <>
          <section className={styles.section} aria-labelledby="reminders-summary-heading">
            <h3 id="reminders-summary-heading" className={styles.heading}>
              每日摘要
            </h3>
            <ul className={styles.list}>
              {SUMMARY_ITEMS.map(({ kind, label }) => {
                const entry = displaySettings[kind]
                return (
                  <li key={kind} className={styles.summaryRow}>
                    <span className={styles.summaryLabel}>{label}</span>
                    <div className={styles.summaryControls}>
                      <input
                        type="time"
                        className={styles.timeInput}
                        aria-label={`${label}時刻`}
                        value={entry.time}
                        onChange={(e) => updateSummary(kind, { time: e.target.value })}
                      />
                      <button
                        type="button"
                        className={styles.toggleButton}
                        aria-pressed={entry.enabled}
                        aria-label={`${label}開關`}
                        onClick={() => updateSummary(kind, { enabled: !entry.enabled })}
                      >
                        {entry.enabled ? '開啟' : '關閉'}
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
            {outOfOrder && (
              <p className={styles.fieldError} role="alert">
                順序不對,還沒儲存
              </p>
            )}
          </section>

          <section className={styles.section} aria-labelledby="reminders-upcoming-heading">
            <h3 id="reminders-upcoming-heading" className={styles.heading}>
              接下來會送的提醒
            </h3>
            {upcoming.length === 0 ? (
              <p className={styles.empty}>接下來 24 小時沒有排定的提醒</p>
            ) : (
              <ul className={styles.list}>
                {upcoming.map((item, index) => {
                  const dayLabel = item.date === today ? '今天' : '明天'
                  const timeText = `${dayLabel} ${item.time}`
                  const key =
                    item.kind === 'summary'
                      ? `summary-${item.date}-${item.summary}`
                      : `${item.kind}-${item.date}-${item.reminderId}-${index}`

                  if (item.kind === 'summary') {
                    return (
                      <li key={key} className={styles.row}>
                        <div className={styles.rowMain}>
                          <span className={styles.timeBadge}>{timeText}</span>
                          <span className={styles.itemText}>{item.title}</span>
                        </div>
                        <span className={styles.kindMeta}>摘要</span>
                      </li>
                    )
                  }

                  if (item.kind === 'habit') {
                    return (
                      <li key={key} className={styles.row}>
                        <div className={styles.rowMain}>
                          <span className={styles.timeBadge}>{timeText}</span>
                          <button
                            type="button"
                            className={styles.itemButton}
                            onClick={() => onOpenHabit(item.habitId)}
                          >
                            {item.title}
                          </button>
                        </div>
                        <span className={styles.kindMeta}>習慣</span>
                      </li>
                    )
                  }

                  const targetTaskId =
                    item.taskId !== null
                      ? item.taskId
                      : item.ruleId !== null
                        ? (earliestIncomplete(tasks, item.ruleId)?.id ?? null)
                        : null

                  return (
                    <li key={key} className={styles.row}>
                      <div className={styles.rowMain}>
                        <span className={styles.timeBadge}>{timeText}</span>
                        {targetTaskId !== null ? (
                          <button
                            type="button"
                            className={styles.itemButton}
                            onClick={() => onOpenTask(targetTaskId)}
                          >
                            {item.title}
                          </button>
                        ) : (
                          <span className={styles.itemText}>{item.title}</span>
                        )}
                      </div>
                      <span className={styles.kindMeta}>任務</span>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          <section className={styles.section} aria-labelledby="reminders-excluded-heading">
            <h3 id="reminders-excluded-heading" className={styles.heading}>
              不進摘要的項目
            </h3>
            {!hasExcluded ? (
              <p className={styles.empty}>目前沒有設為不進摘要的項目</p>
            ) : (
              <ul className={styles.list}>
                {excludedTasks.map((task) => (
                  <li key={`task-${task.id}`} className={styles.row}>
                    <button
                      type="button"
                      className={styles.itemButton}
                      onClick={() =>
                        onOpenTask(task.id, task.completedAt !== null ? 'done' : 'open')
                      }
                    >
                      {task.title}
                    </button>
                    <span className={styles.kindMeta}>任務</span>
                  </li>
                ))}
                {excludedRules.map((rule) => {
                  const representative =
                    earliestIncomplete(tasks, rule.id) ??
                    tasks.find((task) => task.recurrenceRuleId === rule.id)
                  const title = rule.title ?? representative?.title ?? `規則 #${rule.id}`
                  return (
                    <li key={`rule-${rule.id}`} className={styles.row}>
                      {representative !== undefined ? (
                        <button
                          type="button"
                          className={styles.itemButton}
                          onClick={() =>
                            onOpenTask(
                              representative.id,
                              representative.completedAt !== null ? 'done' : 'open',
                            )
                          }
                        >
                          {title}
                        </button>
                      ) : (
                        <span className={styles.itemText}>{title}</span>
                      )}
                      <span className={styles.kindMeta}>重複規則</span>
                    </li>
                  )
                })}
                {excludedHabits.map((habit) => (
                  <li key={`habit-${habit.id}`} className={styles.row}>
                    <button
                      type="button"
                      className={styles.itemButton}
                      onClick={() => onOpenHabit(habit.id)}
                    >
                      {habit.name}
                    </button>
                    <span className={styles.kindMeta}>習慣</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  )
}
