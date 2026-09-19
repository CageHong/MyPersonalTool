import { useEffect, useRef, useState, type RefObject } from 'react'
import MonthCalendar from './MonthCalendar'
import RecurrenceCustomFields from './RecurrenceCustomFields'
import type { RuleState } from './RecurrenceSummary'
import { addDays, formatShortDate, nextWeekday, onOrNextWeekday, parseIso, todayIso } from '@/lib/date'
import { describeRule, expandRule, firstOccurrence } from '@/lib/recurrence'
import {
  initialDraft,
  labelAnchor,
  presetLabel,
  recurrenceChanges,
  REPEAT_CHOICES,
  resolveSpec,
  validateCustom,
  type CustomDraft,
  type CustomErrors,
  type RecurrenceDraft,
  type RecurrenceRequest,
  type RepeatChoice,
} from '@/lib/recurrenceDraft'
import type { DueDateDraft } from '@/lib/tasks'
import styles from './DueDateDialog.module.css'

// null = 沒有選值就關掉(Esc、點背景)。recurrence 為 null = 規則沒有變化(或這個選單沒有重複設定)
export type DueDateResult = { dueDate: string | null; recurrence: RecurrenceRequest | null } | null

type Props = {
  dueDate: string | null
  // 唯一的關閉通知,只從 <dialog> 的 close 事件發出;焦點由呼叫端移回觸發鈕
  onClose: (result: DueDateResult) => void
  // 有傳才顯示「重複」「結束」兩列。沒有規則時 rule 是 null;
  // 新增列(任務還不存在)與已完成的任務不傳
  recurrence?: { rule: RuleState | null }
}

// 同一個 <dialog> 裡的畫面:主畫面與三個第二層。不是巢狀 dialog
type View = 'main' | 'repeat' | 'custom' | 'end'

// 切換畫面後焦點要落的位置;切換的當下目標元素還沒掛載,由 effect 在提交後放
type FocusTarget = 'repeatRow' | 'endRow' | 'repeatChoice' | 'customFirst' | 'endChoice'

function formatUntil(iso: string): string {
  const { year, month, day } = parseIso(iso)
  return `直到 ${year}/${month}/${day}`
}

export default function DueDateDialog({ dueDate, onClose, recurrence }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  // 確定與清除先記下結果再 close();close 事件讀它。呼叫端只在開啟時掛載,每次開啟都從 null 開始
  const resultRef = useRef<DueDateResult>(null)
  // 還沒有截止日時草稿預設今天,月曆一開就停在今天那格;實際值不變,仍然要按確定才寫入。
  // 呼叫端都是開啟時才掛載,所以初始值每次開啟都會重算
  const [draft, setDraft] = useState<DueDateDraft>({ dueDate: dueDate ?? todayIso() })
  // 草稿一開就有值;清除是直接關閉送 null,不經過草稿
  const currentDate = draft.dueDate ?? todayIso()

  // 規則:沒有規則是 null;載入中或載入失敗時重複列不能展開
  const ruleState = recurrence?.rule ?? null
  const ruleReady = recurrence !== undefined && (ruleState === null || ruleState.status === 'loaded')
  const rule = ruleState?.status === 'loaded' ? ruleState.rule : null
  // 重複的草稿在規則就緒時才建立:開啟時規則還在載入的話,載入完成後補建(渲染中調整 state)
  const [repeatDraft, setRepeatDraft] = useState<RecurrenceDraft | null>(() =>
    ruleReady ? initialDraft(rule, currentDate) : null,
  )
  if (repeatDraft === null && ruleReady) {
    setRepeatDraft(initialDraft(rule, currentDate))
  }

  // 目前的畫面,與切過去之後焦點要落的位置;每次導覽都是新物件,effect 據此放焦點
  const [screen, setScreen] = useState<{ view: View; focus: FocusTarget | null }>({
    view: 'main',
    focus: null,
  })
  const view = screen.view
  // 第二層各自的編輯中狀態;按「完成」才寫回 repeatDraft
  const [customEdit, setCustomEdit] = useState<CustomDraft | null>(null)
  const [customErrors, setCustomErrors] = useState<CustomErrors>({})
  const [endEdit, setEndEdit] = useState<{ until: string | null; date: string } | null>(null)
  const [endError, setEndError] = useState<string | null>(null)

  const repeatRowRef = useRef<HTMLButtonElement>(null)
  const endRowRef = useRef<HTMLButtonElement>(null)
  const repeatChoiceRef = useRef<HTMLButtonElement>(null)
  const customFirstRef = useRef<HTMLInputElement>(null)
  const endChoiceRef = useRef<HTMLInputElement>(null)

  // showModal() 才有 Esc 關閉、焦點鎖在彈窗內、背景 inert。
  // 關閉後焦點由呼叫端在 close 事件裡明確移回觸發鈕,不靠瀏覽器自動歸還(各瀏覽器不一致)。
  // 開發模式下 effect 會跑兩次,先確認還沒開啟。
  // 焦點明確放在 <dialog> 本身,按一次 Tab 才進到第一個按鈕。不用 React 的 autoFocus:
  // 它在掛載時就 focus(),那時 dialog 還沒 showModal() 不可聚焦,
  // 接著 showModal() 又會自己把焦點給第一個可聚焦的子元素
  useEffect(() => {
    const dialog = ref.current
    if (dialog === null) {
      return
    }
    if (!dialog.open) {
      dialog.showModal()
    }
    dialog.focus()
  }, [])

  // 畫面切換後才放焦點:目標元素在切換的那次渲染才掛載
  useEffect(() => {
    const target = screen.focus
    if (target === null) {
      return
    }
    const refs: Record<FocusTarget, RefObject<HTMLElement | null>> = {
      repeatRow: repeatRowRef,
      endRow: endRowRef,
      repeatChoice: repeatChoiceRef,
      customFirst: customFirstRef,
      endChoice: endChoiceRef,
    }
    refs[target].current?.focus()
  }, [screen])

  function goTo(next: View, focus: FocusTarget) {
    setScreen({ view: next, focus })
  }

  const today = todayIso()
  const shortcuts = [
    { label: '今天', value: today },
    { label: '明天', value: addDays(today, 1) },
    // 最近的週六;今天就是週六的話就是今天
    { label: '本週末', value: onOrNextWeekday(today, 6) },
    // 下一個週一
    { label: '下週', value: nextWeekday(today, 1) },
  ]

  // 草稿目前代表的規則。自訂只在「完成」驗證過才寫進 repeatDraft,所以這裡不會有錯誤
  const resolved = repeatDraft === null ? null : resolveSpec(repeatDraft, currentDate, rule)
  const spec = resolved !== null && 'spec' in resolved ? resolved.spec : null

  // 所有關閉路徑(確定、清除、Esc、點背景)都經 close(),再由 close 事件通知呼叫端。
  // 不能讓呼叫端直接卸載開啟中的 <dialog>:那樣不會觸發 close,焦點會掉到 body
  function closeWith(result: DueDateResult) {
    resultRef.current = result
    ref.current?.close()
  }

  function confirm() {
    closeWith({
      dueDate: currentDate,
      recurrence: repeatDraft === null ? null : recurrenceChanges(rule, spec),
    })
  }

  function chooseRepeat(choice: RepeatChoice) {
    if (repeatDraft === null) {
      return
    }
    if (choice === 'custom') {
      setCustomEdit(repeatDraft.custom)
      setCustomErrors({})
      goTo('custom', 'customFirst')
      return
    }
    setRepeatDraft({ ...repeatDraft, repeat: choice })
    goTo('main', 'repeatRow')
  }

  function finishCustom() {
    if (repeatDraft === null || customEdit === null) {
      return
    }
    // 不合法就留在自訂畫面顯示訊息;不停用「完成」
    const errors = validateCustom(customEdit)
    if (Object.keys(errors).length > 0) {
      setCustomErrors(errors)
      return
    }
    setRepeatDraft({ ...repeatDraft, repeat: 'custom', custom: customEdit })
    goTo('main', 'repeatRow')
  }

  function openEnd() {
    if (repeatDraft === null) {
      return
    }
    setEndEdit({ until: repeatDraft.until, date: repeatDraft.until ?? currentDate })
    setEndError(null)
    goTo('end', 'endChoice')
  }

  function finishEnd() {
    if (repeatDraft === null || endEdit === null) {
      return
    }
    // 結束日早於第一次的話規則一個實例都沒有;伺服器也會拒絕,這裡先擋下來說清楚
    if (endEdit.until !== null && spec !== null) {
      const first = firstOccurrence(spec)
      if (endEdit.until < first) {
        setEndError(`結束日不能早於第一次(${formatShortDate(first, today)})`)
        return
      }
    }
    setRepeatDraft({ ...repeatDraft, until: endEdit.until })
    goTo('main', 'endRow')
  }

  // × 停止重複:「結束」列與 × 本身都會消失,焦點回「重複」列
  function removeRepeat() {
    if (repeatDraft === null) {
      return
    }
    setRepeatDraft({ ...repeatDraft, repeat: 'none' })
    goTo('main', 'repeatRow')
  }

  function repeatRowText(): string {
    if (ruleState?.status === 'loading') {
      return '載入中…'
    }
    if (ruleState?.status === 'failed' || repeatDraft === null) {
      return '—'
    }
    // 結束日另外一列顯示
    return spec === null ? '不重複' : describeRule({ ...spec, until: null })
  }

  function renderMain() {
    return (
      <>
        <div className={styles.shortcuts}>
          {shortcuts.map((shortcut) => (
            <button
              key={shortcut.label}
              type="button"
              className={styles.shortcut}
              // 快捷鍵只改草稿,一樣要按確定才送出
              onClick={() => setDraft((current) => ({ ...current, dueDate: shortcut.value }))}
            >
              {shortcut.label}
            </button>
          ))}
        </div>

        <MonthCalendar
          value={draft.dueDate}
          onSelect={(iso) => setDraft((current) => ({ ...current, dueDate: iso }))}
          // 預覽:接下來符合規則的日期;until 之後、錨點之前的 expandRule 本身就不會給
          marked={spec === null ? undefined : (first, last) => new Set(expandRule(spec, first, last))}
        />

        {recurrence !== undefined && (
          <div className={styles.settings}>
            <div className={styles.setting}>
              <span className={styles.settingLabel}>重複</span>
              <button
                ref={repeatRowRef}
                type="button"
                className={styles.settingValue}
                // 規則還沒載入完成時不展開;不停用按鈕
                onClick={() => {
                  if (repeatDraft !== null) {
                    goTo('repeat', 'repeatChoice')
                  }
                }}
                aria-label={`重複:${repeatRowText()}`}
              >
                {repeatRowText()}
              </button>
              {spec !== null && (
                <button
                  type="button"
                  className={styles.remove}
                  onClick={removeRepeat}
                  aria-label="停止重複"
                >
                  ×
                </button>
              )}
            </div>

            {spec !== null && repeatDraft !== null && (
              <div className={styles.setting}>
                <span className={styles.settingLabel}>結束</span>
                <button
                  ref={endRowRef}
                  type="button"
                  className={styles.settingValue}
                  onClick={openEnd}
                >
                  {repeatDraft.until === null ? '永不結束' : formatUntil(repeatDraft.until)}
                </button>
              </div>
            )}
          </div>
        )}

        <div className={styles.footer}>
          {/* 清除 = 截止日設成 null 並送出;規則需要錨點,這次對重複的草稿一併捨棄 */}
          <button
            type="button"
            className={styles.clear}
            onClick={() => closeWith({ dueDate: null, recurrence: null })}
          >
            清除
          </button>
          <button type="button" className={styles.confirm} onClick={confirm}>
            確定
          </button>
        </div>
      </>
    )
  }

  function renderRepeatList() {
    const selected = repeatDraft?.repeat ?? 'none'
    return (
      <>
        <div className={styles.subheader}>
          <span className={styles.settingLabel}>重複</span>
          <button type="button" className={styles.back} onClick={() => goTo('main', 'repeatRow')}>
            返回
          </button>
        </div>
        <ul className={styles.choices}>
          {REPEAT_CHOICES.map((choice) => (
            <li key={choice}>
              <button
                ref={choice === selected ? repeatChoiceRef : undefined}
                type="button"
                className={styles.choice}
                aria-pressed={choice === selected}
                onClick={() => chooseRepeat(choice)}
              >
                <span className={styles.check} aria-hidden>
                  {choice === selected ? '✓' : ''}
                </span>
                {presetLabel(choice, labelAnchor(choice, selected, rule, currentDate))}
              </button>
            </li>
          ))}
        </ul>
      </>
    )
  }

  function renderCustom() {
    if (customEdit === null) {
      return null
    }
    return (
      <>
        <div className={styles.subheader}>
          <span className={styles.settingLabel}>自訂重複</span>
          <button type="button" className={styles.back} onClick={() => goTo('main', 'repeatRow')}>
            返回
          </button>
        </div>
        <RecurrenceCustomFields
          value={customEdit}
          errors={customErrors}
          firstFieldRef={customFirstRef}
          onChange={(patch, clears) => {
            setCustomEdit({ ...customEdit, ...patch })
            // 一修改該欄位就清掉它的錯誤
            setCustomErrors((current) => {
              if (current[clears] === undefined) {
                return current
              }
              const next = { ...current }
              delete next[clears]
              return next
            })
          }}
        />
        <div className={styles.footer}>
          <span />
          <button type="button" className={styles.confirm} onClick={finishCustom}>
            完成
          </button>
        </div>
      </>
    )
  }

  function renderEnd() {
    if (endEdit === null) {
      return null
    }
    const byDate = endEdit.until !== null
    return (
      <>
        <div className={styles.subheader}>
          <span className={styles.settingLabel}>結束</span>
          <button type="button" className={styles.back} onClick={() => goTo('main', 'endRow')}>
            返回
          </button>
        </div>
        <fieldset className={styles.endOptions}>
          <legend className={styles.visuallyHidden}>結束</legend>
          <label className={styles.endOption}>
            <input
              ref={byDate ? undefined : endChoiceRef}
              type="radio"
              name="recurrence-end"
              checked={!byDate}
              onChange={() => {
                setEndEdit({ ...endEdit, until: null })
                setEndError(null)
              }}
            />
            永不結束
          </label>
          <label className={styles.endOption}>
            <input
              ref={byDate ? endChoiceRef : undefined}
              type="radio"
              name="recurrence-end"
              checked={byDate}
              onChange={() => {
                setEndEdit({ ...endEdit, until: endEdit.date })
                setEndError(null)
              }}
            />
            按日期結束
          </label>
        </fieldset>
        {byDate && (
          <MonthCalendar
            value={endEdit.until}
            onSelect={(iso) => {
              setEndEdit({ until: iso, date: iso })
              setEndError(null)
            }}
          />
        )}
        {endError !== null && (
          <p className={styles.error} role="alert">
            {endError}
          </p>
        )}
        <div className={styles.footer}>
          <span />
          <button type="button" className={styles.confirm} onClick={finishEnd}>
            完成
          </button>
        </div>
      </>
    )
  }

  const returnFocus: Record<Exclude<View, 'main'>, FocusTarget> = {
    repeat: 'repeatRow',
    custom: 'repeatRow',
    end: 'endRow',
  }

  return (
    <dialog
      ref={ref}
      tabIndex={-1}
      className={styles.dialog}
      aria-label="截止日"
      // Esc 由瀏覽器直接關閉,resultRef 維持 null。第二層按 Esc 只退回主畫面,不關閉
      onCancel={(event) => {
        if (view !== 'main') {
          event.preventDefault()
          goTo('main', returnFocus[view])
        }
      }}
      onClose={() => onClose(resultRef.current)}
      // dialog 自己沒有內距,點到它本身就是點到 backdrop
      onClick={(event) => {
        if (event.target === ref.current) {
          closeWith(null)
        }
      }}
    >
      <div className={styles.content}>
        {view === 'main' && renderMain()}
        {view === 'repeat' && renderRepeatList()}
        {view === 'custom' && renderCustom()}
        {view === 'end' && renderEnd()}
      </div>
    </dialog>
  )
}
