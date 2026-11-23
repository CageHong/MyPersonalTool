import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import CrossIcon from './CrossIcon'
import {
  fieldMessage,
  generalMessage,
  habitMessage,
  NETWORK_ERROR,
  readApiError,
  recurrenceRuleMessage,
  reminderMessage,
  type ApiError,
  type FieldErrors,
} from '@/modules/tasks/lib/errors'
import {
  formatReminderLabel,
  MAX_REMINDERS,
  type ReminderInput,
  type ReminderItem,
} from '@/modules/tasks/lib/reminders'
import styles from './ReminderEditor.module.css'

export type ReminderOwner = { taskId: number } | { ruleId: number } | { habitId: number }

type Props = {
  owner: ReminderOwner
  today: string
  onError: (message: string | null) => void
  onChanged?: () => void
}

function ownerQuery(owner: ReminderOwner): string {
  if ('taskId' in owner) return `taskId=${owner.taskId}`
  if ('ruleId' in owner) return `ruleId=${owner.ruleId}`
  return `habitId=${owner.habitId}`
}

function ownerNotFoundMessage(owner: ReminderOwner, failure: ApiError): string | null {
  if (failure.kind !== 'general') {
    return null
  }
  if ('habitId' in owner) {
    return habitMessage(failure.code)
  }
  if ('ruleId' in owner) {
    return recurrenceRuleMessage(failure.code)
  }
  return generalMessage(failure.code)
}

export default function ReminderEditor({ owner, today, onError, onChanged }: Props) {
  const [items, setItems] = useState<ReminderItem[]>([])
  const [loading, setLoading] = useState(true)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})

  const isTask = 'taskId' in owner
  const isRule = 'ruleId' in owner
  const maxDaysBefore = isRule ? 6 : 28

  const [kind, setKind] = useState<'relative' | 'absolute'>('relative')
  const [daysBefore, setDaysBefore] = useState(0)
  const [date, setDate] = useState(today)
  const [time, setTime] = useState('09:00')

  const queueRef = useRef<Promise<unknown>>(Promise.resolve())
  const addPendingRef = useRef(false)
  const deletingIdsRef = useRef(new Set<number>())

  const enqueue = useCallback(<T,>(job: () => Promise<T>): Promise<T> => {
    const next = queueRef.current.then(job)
    queueRef.current = next.catch(() => undefined)
    return next
  }, [])

  const query = ownerQuery(owner)

  const fetchReminders = useCallback(async (): Promise<ApiError | null> => {
    const response = await fetch(`/api/tasks/reminders?${query}`)
    if (!response.ok) {
      return await readApiError(response)
    }
    setItems((await response.json()) as ReminderItem[])
    return null
  }, [query])

  useEffect(() => {
    let ignore = false
    void enqueue(async () => {
      try {
        const response = await fetch(`/api/tasks/reminders?${query}`)
        if (ignore) return
        if (!response.ok) {
          const failure = await readApiError(response)
          if (!ignore) {
            onError(ownerNotFoundMessage(owner, failure))
          }
          return
        }
        const loaded = (await response.json()) as ReminderItem[]
        if (!ignore) {
          setItems(loaded)
        }
      } catch {
        if (!ignore) {
          onError(generalMessage('NETWORK'))
        }
      } finally {
        if (!ignore) {
          setLoading(false)
        }
      }
    })
    return () => {
      ignore = true
    }
  }, [enqueue, onError, owner, query])

  function clearErrors() {
    setFieldErrors((current) => (Object.keys(current).length === 0 ? current : {}))
  }

  function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (addPendingRef.current || items.length >= MAX_REMINDERS) {
      return
    }

    let input: ReminderInput
    if ('habitId' in owner) {
      input = { kind: 'daily', time }
    } else if (isRule || kind === 'relative') {
      input = { kind: 'relative', daysBefore, time }
    } else {
      input = { kind: 'absolute', date, time }
    }

    addPendingRef.current = true
    void enqueue(async () => {
      try {
        const response = await fetch('/api/tasks/reminders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...owner, ...input }),
        })
        if (!response.ok) {
          const failure = await readApiError(response)
          if (failure.kind === 'fields') {
            setFieldErrors(failure.fields)
            onError(null)
          } else {
            onError(ownerNotFoundMessage(owner, failure))
          }
          return failure
        }
        setFieldErrors({})
        const refetchFailure = await fetchReminders()
        onError(refetchFailure === null ? null : ownerNotFoundMessage(owner, refetchFailure))
        onChanged?.()
        return refetchFailure
      } catch {
        onError(generalMessage('NETWORK'))
        return NETWORK_ERROR
      } finally {
        addPendingRef.current = false
      }
    })
  }

  function handleDelete(reminderId: number) {
    if (deletingIdsRef.current.has(reminderId)) {
      return
    }
    deletingIdsRef.current.add(reminderId)
    void enqueue(async () => {
      try {
        const response = await fetch(`/api/tasks/reminders/${reminderId}`, {
          method: 'DELETE',
        })
        if (!response.ok) {
          const failure = await readApiError(response)
          onError(failure.kind === 'general' ? reminderMessage(failure.code) : null)
          return failure
        }
        setFieldErrors({})
        const refetchFailure = await fetchReminders()
        onError(refetchFailure === null ? null : ownerNotFoundMessage(owner, refetchFailure))
        onChanged?.()
        return refetchFailure
      } catch {
        onError(generalMessage('NETWORK'))
        return NETWORK_ERROR
      } finally {
        deletingIdsRef.current.delete(reminderId)
      }
    })
  }

  const errorEntries = Object.entries(fieldErrors)
  const dayOptions = Array.from({ length: maxDaysBefore + 1 }, (_, i) => i)

  return (
    <div className={styles.editor}>
      {!loading && items.length > 0 && (
        <ul className={styles.list} aria-label="已設定的提醒">
          {items.map((item) => {
            const label = formatReminderLabel(item)
            return (
              <li key={item.id} className={styles.item}>
                <span className={styles.itemLabel}>{label}</span>
                <button
                  type="button"
                  className={styles.delete}
                  onClick={() => handleDelete(item.id)}
                  aria-label={`刪除提醒 ${label}`}
                >
                  <CrossIcon />
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {items.length >= MAX_REMINDERS ? (
        <p className={styles.limitNote}>最多只能設 5 則提醒</p>
      ) : (
        <form className={styles.form} onSubmit={handleAdd}>
          {isTask && (
            <select
              className={styles.select}
              aria-label="提醒類型"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as 'relative' | 'absolute')
                clearErrors()
              }}
            >
              <option value="relative">相對到期日</option>
              <option value="absolute">某天</option>
            </select>
          )}

          {(isRule || (isTask && kind === 'relative')) && (
            <select
              className={styles.select}
              aria-label="提前天數"
              value={daysBefore}
              onChange={(e) => {
                setDaysBefore(Number(e.target.value))
                clearErrors()
              }}
            >
              {dayOptions.map((d) => (
                <option key={d} value={d}>
                  {d === 0 ? '當天' : `提前 ${d} 天`}
                </option>
              ))}
            </select>
          )}

          {isTask && kind === 'absolute' && (
            <input
              type="date"
              className={styles.input}
              aria-label="提醒日期"
              value={date}
              onChange={(e) => {
                setDate(e.target.value)
                clearErrors()
              }}
            />
          )}

          {'habitId' in owner && <span className={styles.prefix}>每天</span>}

          <input
            type="time"
            className={styles.input}
            aria-label="提醒時刻"
            value={time}
            onChange={(e) => {
              setTime(e.target.value)
              clearErrors()
            }}
          />

          <button type="submit" className={styles.addButton}>
            新增提醒
          </button>
        </form>
      )}

      {errorEntries.map(([field, code]) => (
        <p key={field} className={styles.fieldError} role="alert">
          {fieldMessage(field, code)}
        </p>
      ))}
    </div>
  )
}
