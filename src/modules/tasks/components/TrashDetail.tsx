import { useEffect, useId, useRef, useState } from 'react'
import ConfirmDialog from './ConfirmDialog'
import { useRecurrenceRule } from './RecurrenceSummary'
import TaskListSkeleton from './TaskListSkeleton'
import type { ChecklistItem } from '@/modules/tasks/lib/checklist'
import { formatListDate, formatListDay, formatLongDate } from '@/modules/tasks/lib/date'
import { generalMessage, readApiError, type ApiError } from '@/modules/tasks/lib/errors'
import { describeRule } from '@/modules/tasks/lib/recurrence'
import { priorityLevel, type Task } from '@/modules/tasks/lib/tasks'
import { localDate } from '@/platform/date'
import styles from './TrashDetail.module.css'

// 垃圾桶視圖的右欄:唯讀檢視,不能編輯欄位、checklist、提醒;只提供「還原」與「永久刪除」(decisions §6h)
type Props = {
  task: Task | undefined
  today: string
  tasksVersion: number
  onRestore: (id: number) => Promise<ApiError | null>
  onPurge: (id: number) => Promise<ApiError | null>
  onError: (message: string | null) => void
}

export default function TrashDetail({ task, ...rest }: Props) {
  if (task === undefined) {
    return <p className={styles.empty}>未選取任務</p>
  }
  return <TrashDetailContent task={task} {...rest} />
}

function TrashDetailContent({
  task,
  today,
  tasksVersion,
  onRestore,
  onPurge,
  onError,
}: Omit<Props, 'task'> & { task: Task }) {
  // 存正在確認永久刪除的任務 id,不存布林值(decisions §5)
  const [confirmingId, setConfirmingId] = useState<number | null>(null)
  const purgeButtonRef = useRef<HTMLButtonElement>(null)
  const restorePendingRef = useRef(false)
  const checklistLabelId = useId()

  const [items, setItems] = useState<ChecklistItem[]>([])
  const [checklistLoading, setChecklistLoading] = useState(true)
  const [checklistFailed, setChecklistFailed] = useState(false)

  useEffect(() => {
    let ignore = false
    void (async () => {
      try {
        const response = await fetch(`/api/tasks/tasks/${task.id}/checklist-items`)
        if (ignore) {
          return
        }
        if (!response.ok) {
          const failure = await readApiError(response)
          if (!ignore) {
            setChecklistFailed(true)
            onError(failure.kind === 'general' ? generalMessage(failure.code) : null)
          }
          return
        }
        const loaded = (await response.json()) as ChecklistItem[]
        if (!ignore) {
          setItems(loaded)
          setChecklistFailed(false)
        }
      } catch {
        if (!ignore) {
          setChecklistFailed(true)
          onError(generalMessage('NETWORK'))
        }
      } finally {
        if (!ignore) {
          setChecklistLoading(false)
        }
      }
    })()
    return () => {
      ignore = true
    }
  }, [onError, task.id])

  const ruleSnapshot = useRecurrenceRule(task.recurrenceRuleId, tasksVersion, onError)
  const ruleState = ruleSnapshot?.state ?? null

  const occurrenceDate = task.occurrenceDate
  const moved = task.dueDate !== null && occurrenceDate !== null && task.dueDate !== occurrenceDate
  const level = priorityLevel(task.priority)
  const deletedText =
    task.deletedAt != null ? formatLongDate(localDate(new Date(task.deletedAt * 1000))) : null

  let recurrenceText: string | null = null
  let recurrenceStopped = false
  if (ruleState !== null) {
    if (ruleState.status === 'loading') {
      recurrenceText = '載入中…'
    } else if (ruleState.status === 'failed') {
      recurrenceText = '—'
    } else {
      recurrenceStopped = ruleState.rule.endedAt !== null
      recurrenceText = describeRule(ruleState.rule, { stopped: recurrenceStopped })
    }
  }

  return (
    // data-task-id:還原或永久刪除讓任務離開垃圾桶時,ThreeColumnLayout 靠它做焦點遞補
    <article className={styles.detail} data-task-id={task.id}>
      <ConfirmDialog
        open={confirmingId === task.id}
        title="永久刪除任務?"
        description={`「${task.title}」會永久刪除,無法復原。`}
        confirmLabel="永久刪除"
        onConfirm={async () => {
          await onPurge(task.id)
          setConfirmingId(null)
        }}
        onCancel={() => setConfirmingId(null)}
        triggerRef={purgeButtonRef}
      />

      <div className={styles.field}>
        <span className={styles.fieldLabel}>標題</span>
        <p className={task.completedAt !== null ? `${styles.title} ${styles.completed}` : styles.title}>
          {task.title}
        </p>
      </div>

      <div className={styles.field}>
        <span className={styles.fieldLabel}>描述</span>
        {task.notes ? (
          <p className={styles.notes}>{task.notes}</p>
        ) : (
          <p className={styles.muted}>沒有描述</p>
        )}
      </div>

      <div className={styles.field}>
        <span className={styles.fieldLabel} id={checklistLabelId}>
          檢查項目
        </span>
        {checklistLoading && <TaskListSkeleton />}
        {!checklistLoading && !checklistFailed && items.length === 0 && (
          <p className={styles.muted}>還沒有檢查項目</p>
        )}
        {!checklistLoading && items.length > 0 && (
          <ul className={styles.checklist} aria-labelledby={checklistLabelId}>
            {items.map((item) => {
              const done = item.completedAt !== null
              return (
                <li
                  key={item.id}
                  className={done ? `${styles.checklistItem} ${styles.checklistDone}` : styles.checklistItem}
                >
                  <span
                    className={done ? `${styles.checkBox} ${styles.checkBoxChecked}` : styles.checkBox}
                    aria-hidden="true"
                  />
                  <span className={styles.checklistTitle}>{item.title}</span>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className={styles.field}>
        <span className={styles.fieldLabel}>截止日</span>
        <p className={task.dueDate !== null ? styles.value : styles.muted}>
          {task.dueDate !== null ? formatListDate(task.dueDate, today) : '無'}
        </p>
        {moved && <p className={styles.muted}>原定 {formatListDay(occurrenceDate, today)}</p>}
      </div>

      <div className={styles.field}>
        <span className={styles.fieldLabel}>優先級</span>
        <p className={level !== undefined ? styles.value : styles.muted}>{level?.label ?? '無'}</p>
      </div>

      <div className={styles.field}>
        <span className={styles.fieldLabel}>置頂</span>
        <p className={task.pinned ? styles.value : styles.muted}>{task.pinned ? '已置頂' : '未置頂'}</p>
      </div>

      {recurrenceText !== null && (
        <div className={styles.field}>
          <span className={styles.fieldLabel}>重複</span>
          <p className={ruleState?.status === 'loaded' ? styles.value : styles.muted}>
            {recurrenceText}
            {recurrenceStopped ? '（已停止重複）' : ''}
          </p>
        </div>
      )}

      {deletedText !== null && (
        <div className={styles.field}>
          <span className={styles.fieldLabel}>刪除日期</span>
          <p className={styles.muted}>{deletedText}</p>
        </div>
      )}

      <div className={styles.footer}>
        <button
          type="button"
          className={styles.restoreButton}
          onClick={() => {
            if (restorePendingRef.current) {
              return
            }
            restorePendingRef.current = true
            void onRestore(task.id).finally(() => {
              restorePendingRef.current = false
            })
          }}
          aria-label={`還原「${task.title}」`}
        >
          還原
        </button>
        <button
          ref={purgeButtonRef}
          type="button"
          className={styles.delete}
          onClick={() => setConfirmingId(task.id)}
          aria-label={`永久刪除「${task.title}」`}
        >
          永久刪除
        </button>
      </div>
    </article>
  )
}
