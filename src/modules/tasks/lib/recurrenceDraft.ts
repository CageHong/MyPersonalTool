// 日期選單裡「重複」設定的草稿與送出判斷。純函式,前端的 DueDateDialog 使用。
//
// 錨點就是選單裡的日期(docs/decisions.md §6a),預設項括號裡的值都由它推出;
// 唯一的例外是「沿用既有規則」:選的那一項從規則自己的 startDate 推出來和原規則一樣時,
// 就是沒有改,不因為從被移動過的實例打開而變成修改。

import { parseIso } from './date'
import { weekdayBit, type Freq, type RecurrenceRuleView, type RecurrenceSpec } from './recurrence'

export type RepeatChoice = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'weekdays' | 'custom'

// 清單的顯示順序
export const REPEAT_CHOICES: readonly RepeatChoice[] = [
  'none',
  'daily',
  'weekly',
  'monthly',
  'yearly',
  'weekdays',
  'custom',
]

// 週一至週五:bit 0..4
export const WEEKDAYS_MASK = 0b0011111

// 「自訂」的欄位;間隔是輸入框的原始字串,送出前才驗證
export type CustomDraft = { freq: Freq; intervalText: string; weekdays: number }

export type RecurrenceDraft = {
  repeat: RepeatChoice
  custom: CustomDraft
  // 結束日,含當天;null = 永不結束
  until: string | null
}

export type CustomErrors = { interval?: string; weekdays?: string }

const WEEKDAY_NAMES = ['一', '二', '三', '四', '五', '六', '日']

export function isActive(rule: RecurrenceRuleView | null): rule is RecurrenceRuleView {
  return rule !== null && rule.endedAt === null
}

// 規則歸到清單的哪一項。只看規則自己(含 startDate),不看目前的截止日:
// 規則是每週三就永遠是「每週(週三)」,從被移到週四的實例打開也一樣
export function classifyRule(rule: RecurrenceSpec): RepeatChoice {
  if (rule.interval !== 1) {
    return 'custom'
  }
  switch (rule.freq) {
    case 'daily':
      return 'daily'
    case 'weekly':
      if (rule.weekdays === WEEKDAYS_MASK) {
        return 'weekdays'
      }
      return rule.weekdays === weekdayBit(rule.startDate) ? 'weekly' : 'custom'
    case 'monthly':
      return 'monthly'
    case 'yearly':
      return 'yearly'
  }
}

export function customFromRule(rule: RecurrenceSpec): CustomDraft {
  return {
    freq: rule.freq,
    intervalText: String(rule.interval),
    weekdays: rule.weekdays ?? weekdayBit(rule.startDate),
  }
}

// 開啟選單時的草稿:進行中的規則照它分類;沒有規則或已停止都從「不重複」開始
export function initialDraft(rule: RecurrenceRuleView | null, dueDate: string): RecurrenceDraft {
  if (!isActive(rule)) {
    return {
      repeat: 'none',
      custom: { freq: 'weekly', intervalText: '1', weekdays: weekdayBit(dueDate) },
      until: null,
    }
  }
  return { repeat: classifyRule(rule), custom: customFromRule(rule), until: rule.until }
}

// 清單上的文字;括號裡的值由 anchor 推出
export function presetLabel(choice: RepeatChoice, anchor: string): string {
  const { month, day } = parseIso(anchor)
  switch (choice) {
    case 'none':
      return '不重複'
    case 'daily':
      return '每天'
    case 'weekly':
      return `每週（週${WEEKDAY_NAMES[Math.log2(weekdayBit(anchor))]}）`
    case 'monthly':
      return `每月（${day} 日）`
    case 'yearly':
      return `每年（${month} 月 ${day} 日）`
    case 'weekdays':
      return '每個工作日（週一至週五）'
    case 'custom':
      return '自訂'
  }
}

// 清單上某一項的括號用哪個日期:目前選中、且就是既有規則那一項時用規則的 startDate,其他用選單當下的日期
export function labelAnchor(
  choice: RepeatChoice,
  selected: RepeatChoice,
  rule: RecurrenceRuleView | null,
  dueDate: string,
): string {
  return isActive(rule) && choice === selected && choice === classifyRule(rule) ? rule.startDate : dueDate
}

export function parseInterval(text: string): number | null {
  if (!/^\d+$/.test(text.trim())) {
    return null
  }
  const value = Number(text)
  return value >= 1 && value <= 99 ? value : null
}

export function validateCustom(custom: CustomDraft): CustomErrors {
  const errors: CustomErrors = {}
  if (parseInterval(custom.intervalText) === null) {
    errors.interval = '間隔要是 1 到 99 的整數'
  }
  if (custom.freq === 'weekly' && custom.weekdays === 0) {
    errors.weekdays = '至少選一天'
  }
  return errors
}

// 草稿 → 規格,錨點是 anchor。「不重複」回傳 null;自訂不合法時回傳錯誤
export function presetSpec(
  draft: RecurrenceDraft,
  anchor: string,
): { spec: RecurrenceSpec | null } | { errors: CustomErrors } {
  const base = { interval: 1, weekdays: null, startDate: anchor, until: draft.until }
  switch (draft.repeat) {
    case 'none':
      return { spec: null }
    case 'daily':
    case 'monthly':
    case 'yearly':
      return { spec: { ...base, freq: draft.repeat } }
    case 'weekly':
      return { spec: { ...base, freq: 'weekly', weekdays: weekdayBit(anchor) } }
    case 'weekdays':
      return { spec: { ...base, freq: 'weekly', weekdays: WEEKDAYS_MASK } }
    case 'custom': {
      const errors = validateCustom(draft.custom)
      const interval = parseInterval(draft.custom.intervalText)
      if (interval === null || Object.keys(errors).length > 0) {
        return { errors }
      }
      const { freq, weekdays } = draft.custom
      return { spec: { ...base, freq, interval, weekdays: freq === 'weekly' ? weekdays : null } }
    }
  }
}

function sameCadence(a: RecurrenceSpec, b: RecurrenceSpec): boolean {
  return (
    a.freq === b.freq &&
    a.interval === b.interval &&
    a.weekdays === b.weekdays &&
    a.startDate === b.startDate
  )
}

// 草稿最後代表的規格。錨點是選單裡的日期;但從既有規則的 startDate 推出來就和原規則同一個節奏時,
// 用那個版本 —— 代表使用者沒有改節奏,不該因為截止日不同就變成修改
export function resolveSpec(
  draft: RecurrenceDraft,
  dueDate: string,
  rule: RecurrenceRuleView | null,
): { spec: RecurrenceSpec | null } | { errors: CustomErrors } {
  const own = presetSpec(draft, dueDate)
  if (!isActive(rule) || 'errors' in own) {
    return own
  }
  const fromRule = presetSpec(draft, rule.startDate)
  if ('spec' in fromRule && fromRule.spec !== null && sameCadence(fromRule.spec, rule)) {
    return fromRule
  }
  return own
}

export type RuleChanges = {
  freq?: Freq
  interval?: number
  weekdays?: number | null
  startDate?: string
  until?: string | null
}

// 送哪個規則端點;null = 規則沒有變化,不送
export type RecurrenceRequest =
  | { kind: 'create'; spec: RecurrenceSpec }
  | { kind: 'update'; ruleId: number; changes: RuleChanges }
  | { kind: 'stop'; ruleId: number }

export function recurrenceChanges(
  rule: RecurrenceRuleView | null,
  spec: RecurrenceSpec | null,
): RecurrenceRequest | null {
  // 沒有規則,或規則已停止(停止可逆):選了任何一項都是替這個任務建新規則
  if (!isActive(rule)) {
    return spec === null ? null : { kind: 'create', spec }
  }
  if (spec === null) {
    return { kind: 'stop', ruleId: rule.id }
  }
  const untilChanged = spec.until !== rule.until
  // 節奏變了:連同錨點一起送,錨點就是選單裡的日期
  if (!sameCadence(spec, rule)) {
    const changes: RuleChanges = {
      freq: spec.freq,
      interval: spec.interval,
      weekdays: spec.weekdays,
      startDate: spec.startDate,
    }
    if (untilChanged) {
      changes.until = spec.until
    }
    return { kind: 'update', ruleId: rule.id, changes }
  }
  // 只改結束日:錨點不動
  if (untilChanged) {
    return { kind: 'update', ruleId: rule.id, changes: { until: spec.until } }
  }
  return null
}
