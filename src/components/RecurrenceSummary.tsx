import { useEffect, useState, type Ref } from 'react'
import { generalMessage, readApiError, recurrenceRuleMessage } from '@/lib/errors'
import { describeRule, type RecurrenceRuleView } from '@/lib/recurrence'
import styles from './RecurrenceSummary.module.css'

export type RuleState =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'loaded'; rule: RecurrenceRuleView }

// 實例的規則;右欄的摘要與日期選單的初始草稿共用這一份。
// 競態:TaskDetail 以 key={task.id} 掛載,換任務時整個卸載,舊回應落在已卸載的實例上。
// 同一個任務的 ruleId 也可能變(剛建立規則、停止後重建),StrictMode 也會跑兩次 effect,
// 所以 cleanup 再標記一次,過期的回應不寫 state
export function useRecurrenceRule(
  ruleId: number | null,
  onError: (message: string | null) => void,
): RuleState | null {
  const [state, setState] = useState<{ ruleId: number; value: RuleState } | null>(null)

  useEffect(() => {
    if (ruleId === null) {
      return
    }
    let ignore = false
    void (async () => {
      try {
        const response = await fetch(`/api/recurrence-rules/${ruleId}`)
        if (ignore) {
          return
        }
        if (!response.ok) {
          const failure = await readApiError(response)
          if (ignore) {
            return
          }
          setState({ ruleId, value: { status: 'failed' } })
          onError(failure.kind === 'general' ? recurrenceRuleMessage(failure.code) : null)
          return
        }
        const rule = (await response.json()) as RecurrenceRuleView
        if (!ignore) {
          setState({ ruleId, value: { status: 'loaded', rule } })
        }
      } catch {
        if (!ignore) {
          setState({ ruleId, value: { status: 'failed' } })
          onError(generalMessage('NETWORK'))
        }
      }
    })()
    return () => {
      ignore = true
    }
  }, [onError, ruleId])

  if (ruleId === null) {
    return null
  }
  // 規則換了但新的還沒回來:不拿舊規則的結果充數
  return state?.ruleId === ruleId ? state.value : { status: 'loading' }
}

type Props = {
  state: RuleState
  // 點摘要開啟日期選單,重複設定在那裡改
  onClick: () => void
  ref?: Ref<HTMLButtonElement>
}

// 實例的規則摘要;是日期選單的第二個觸發鈕
export default function RecurrenceSummary({ state, onClick, ref }: Props) {
  let text = '載入中…'
  if (state.status === 'failed') {
    text = '—'
  } else if (state.status === 'loaded') {
    text = describeRule(state.rule, { stopped: state.rule.endedAt !== null })
  }
  const stopped = state.status === 'loaded' && state.rule.endedAt !== null

  return (
    <button
      ref={ref}
      type="button"
      className={styles.summary}
      onClick={onClick}
      aria-label={`重複:${text}${stopped ? ',已停止重複' : ''}`}
    >
      <span className={state.status === 'loaded' ? undefined : styles.muted}>{text}</span>
      {stopped && <span className={styles.muted}>已停止重複</span>}
    </button>
  )
}
