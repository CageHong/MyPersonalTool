import { useEffect, useRef, useState, type RefObject } from 'react'
import { generalMessage, readApiError, recurrenceRuleMessage } from '@/lib/errors'
import { describeRule, type RecurrenceRuleView } from '@/lib/recurrence'
import styles from './RecurrenceSummary.module.css'

type Props = {
  ruleId: number
  // 泛用錯誤交給中欄新增列下方顯示,同 TaskChecklist
  onError: (message: string | null) => void
  // 剛建立規則時為 true:「重複」按鈕被這個摘要取代,焦點掉到 body 的話接到這裡。用完即清
  focusOnMountRef: RefObject<boolean>
}

type State =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'loaded'; rule: RecurrenceRuleView }

// 唯讀的規則摘要;修改與停止重複是之後的事
export default function RecurrenceSummary({ ruleId, onError, focusOnMountRef }: Props) {
  const [state, setState] = useState<State>({ status: 'loading' })
  const containerRef = useRef<HTMLDivElement>(null)

  // 掛載的 effect 在 DOM 提交之後才跑,這時「重複」按鈕已經卸載,判斷 activeElement 才準
  useEffect(() => {
    if (!focusOnMountRef.current) {
      return
    }
    focusOnMountRef.current = false
    if (document.activeElement === null || document.activeElement === document.body) {
      containerRef.current?.focus()
    }
  }, [focusOnMountRef])

  // 競態:TaskDetail 以 key={task.id} 掛載,換任務時整個卸載,舊回應落在已卸載的實例上。
  // 同一個任務的 ruleId 也可能變(剛建立規則),StrictMode 也會跑兩次 effect,
  // 所以 cleanup 再標記一次,過期的回應不寫 state
  useEffect(() => {
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
          setState({ status: 'failed' })
          onError(failure.kind === 'general' ? recurrenceRuleMessage(failure.code) : null)
          return
        }
        const rule = (await response.json()) as RecurrenceRuleView
        if (!ignore) {
          setState({ status: 'loaded', rule })
        }
      } catch {
        if (!ignore) {
          setState({ status: 'failed' })
          onError(generalMessage('NETWORK'))
        }
      }
    })()
    return () => {
      ignore = true
    }
  }, [onError, ruleId])

  return (
    // tabIndex={-1}:不進 Tab 順序,只讓建立規則後的焦點有地方落
    <div ref={containerRef} tabIndex={-1} className={styles.summary}>
      {state.status === 'loading' && <span className={styles.muted}>載入中…</span>}
      {state.status === 'failed' && <span className={styles.muted}>—</span>}
      {state.status === 'loaded' && (
        <>
          <span>{describeRule(state.rule)}</span>
          {state.rule.endedAt !== null && <span className={styles.muted}>已停止重複</span>}
        </>
      )}
    </div>
  )
}
