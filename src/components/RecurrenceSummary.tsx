import { useEffect, useState, type Ref } from 'react'
import { generalMessage, readApiError, recurrenceRuleMessage } from '@/lib/errors'
import { describeRule, type RecurrenceRuleView } from '@/lib/recurrence'
import styles from './RecurrenceSummary.module.css'

export type RuleState =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'loaded'; rule: RecurrenceRuleView }

// 實例的規則;右欄的摘要與日期選單的初始草稿共用這一份。
// version 是任務清單的重抓次數:每次寫入重抓之後規則也重抓。停止、修改規則時任務的欄位不變,
// ruleId 也不變,只看 ruleId 的話摘要會停在舊規則。
// 競態:TaskDetail 以 key={task.id} 掛載,換任務時整個卸載,舊回應落在已卸載的實例上。
// 同一個任務的 ruleId 或 version 也會變,StrictMode 也會跑兩次 effect,
// 所以 cleanup 再標記一次,過期的回應不寫 state
export type RuleSnapshot = {
  state: RuleState
  // 值不是目前版本的結果:摘要照舊顯示(避免閃爍),但日期選單不能拿它組請求
  stale: boolean
}

export function useRecurrenceRule(
  ruleId: number | null,
  version: number,
  onError: (message: string | null) => void,
): RuleSnapshot | null {
  const [loaded, setLoaded] = useState<{ ruleId: number; version: number; value: RuleState } | null>(
    null,
  )

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
          setLoaded({ ruleId, version, value: { status: 'failed' } })
          onError(failure.kind === 'general' ? recurrenceRuleMessage(failure.code) : null)
          return
        }
        const rule = (await response.json()) as RecurrenceRuleView
        if (!ignore) {
          setLoaded({ ruleId, version, value: { status: 'loaded', rule } })
        }
      } catch {
        if (!ignore) {
          setLoaded({ ruleId, version, value: { status: 'failed' } })
          onError(generalMessage('NETWORK'))
        }
      }
    })()
    return () => {
      ignore = true
    }
  }, [onError, ruleId, version])

  if (ruleId === null) {
    return null
  }
  // 換了規則:新的還沒回來前不拿別條規則的結果充數
  if (loaded?.ruleId !== ruleId) {
    return { state: { status: 'loading' }, stale: true }
  }
  // 同一條規則重抓中:先沿用上一份結果
  return { state: loaded.value, stale: loaded.version !== version }
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
