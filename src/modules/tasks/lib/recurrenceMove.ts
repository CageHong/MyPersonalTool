// 改實例日期時的兩種語意:只改這一次 / 改整個重複規則。純函式,DueDateDialog 使用。
// 伺服器邊界不變(修改規則會刪掉今天之後未完成的實例並重新產生),這裡只決定送什麼、怎麼說明

import { formatListDay } from './date'
import { describeRule, weekdayBit, type RecurrenceSpec } from './recurrence'
import type { RuleChanges } from './recurrenceDraft'

// 按確定時要不要先問。日期與規則在同一次操作裡都改了就不問,直接套用到整個規則(R5b 的送出);
// 規則已停止時沒有「整個規則」可改
export function needsScopeQuestion(input: {
  isInstance: boolean
  ruleStopped: boolean
  dateChanged: boolean
  ruleChanged: boolean
}): boolean {
  return input.isInstance && !input.ruleStopped && input.dateChanged && !input.ruleChanged
}

// 「改整個重複規則」送給規則的變更:錨點改成新日期。
// 每週要連 weekdays 一起改,否則錨點換了、星期幾還是舊的:只替換被移動的那一天
// (移除這個實例原定日的星期,加上新日期的星期)。新日期的星期已經在裡面時兩個時段合併,天數減一。
// 結果至少有新日期那一位,不會是 0。其他頻率的日子與相位本來就由 startDate 推出
export function wholeRuleChanges(
  rule: RecurrenceSpec,
  occurrenceDate: string,
  newDate: string,
): RuleChanges {
  if (rule.freq !== 'weekly') {
    return { startDate: newDate }
  }
  const weekdays = ((rule.weekdays ?? 0) & ~weekdayBit(occurrenceDate)) | weekdayBit(newDate)
  return { startDate: newDate, weekdays }
}

// 今天之後的實例:伺服器會刪掉重生,所以先移它再改規則。
// 今天或逾期的實例:伺服器只從明天起重生,移動它會讓新日期出現兩筆,所以它不動,只改規則
export function movesInstance(occurrenceDate: string, today: string): boolean {
  return occurrenceDate > today
}

function cadence(rule: RecurrenceSpec): string {
  return describeRule({ ...rule, until: null })
}

export function onlyThisText(
  rule: RecurrenceSpec,
  fromDate: string,
  newDate: string,
  today: string,
): string {
  return `${formatListDay(fromDate, today)} → ${formatListDay(newDate, today)}，之後仍是${cadence(rule)}`
}

export function wholeRuleText(
  rule: RecurrenceSpec,
  occurrenceDate: string,
  currentDate: string,
  newDate: string,
  today: string,
): string {
  const next = { ...rule, ...wholeRuleChanges(rule, occurrenceDate, newDate) }
  if (movesInstance(occurrenceDate, today)) {
    return `改成${cadence(next)}，${formatListDay(newDate, today)} 之後每一次都依新規則`
  }
  return `這一次維持 ${formatListDay(currentDate, today)}；從明天起改成${cadence(next)}`
}

export const WHOLE_RULE_NOTE = '今天之後未完成的實例會重新產生，之前對個別實例的日期調整會消失'
