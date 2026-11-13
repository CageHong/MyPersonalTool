// 週期項目(固定收支的「預期」)。目前只有配對模式:不產生交易,匯入的真實交易符合條件時連結到項目。
//
// 配對條件:收款人相同 + 幣別相同 + 金額在 [amountMin, amountMax] + 日期在 [startsOn, endsOn](有設定時)
// + 項目是啟用的。日期用交易時間的 UTC 日期。同時符合兩個以上的項目時不配對,交給呼叫的人回報。
import { eq } from 'drizzle-orm'
import type { FinanceConn } from '../../db/index'
import { financeScheduledTransactions } from '../../db/schema'

export type ScheduledItem = {
  id: number
  // 配對到的交易要記到的分類
  accountId: number
  payeeId: number
  amountMin: number
  amountMax: number
  currency: string
  startsOn: string | null
  endsOn: string | null
}

// 一筆交易在分類那一側的樣子
export type ScheduledCandidate = {
  payeeId: number
  currency: string
  // 最小貨幣單位,正數
  amount: number
  // UTC 的 ISO 8601
  occurredAt: string
}

export type ScheduledMatch =
  | { status: 'none' }
  | { status: 'matched'; item: ScheduledItem }
  | { status: 'ambiguous'; itemIds: number[] }

// 啟用中的週期項目
export function loadScheduledItems(db: FinanceConn): ScheduledItem[] {
  return db
    .select({
      id: financeScheduledTransactions.id,
      accountId: financeScheduledTransactions.accountId,
      payeeId: financeScheduledTransactions.payeeId,
      amountMin: financeScheduledTransactions.amountMin,
      amountMax: financeScheduledTransactions.amountMax,
      currency: financeScheduledTransactions.currency,
      startsOn: financeScheduledTransactions.startsOn,
      endsOn: financeScheduledTransactions.endsOn,
    })
    .from(financeScheduledTransactions)
    .where(eq(financeScheduledTransactions.isActive, true))
    .all()
}

// 純函式
export function matchScheduled(
  items: readonly ScheduledItem[],
  candidate: ScheduledCandidate,
): ScheduledMatch {
  const date = candidate.occurredAt.slice(0, 10)
  const hits = items.filter(
    (item) =>
      item.payeeId === candidate.payeeId &&
      item.currency === candidate.currency &&
      candidate.amount >= item.amountMin &&
      candidate.amount <= item.amountMax &&
      (item.startsOn === null || date >= item.startsOn) &&
      (item.endsOn === null || date <= item.endsOn),
  )
  if (hits.length === 0) return { status: 'none' }
  if (hits.length === 1) return { status: 'matched', item: hits[0] }
  return { status: 'ambiguous', itemIds: hits.map((item) => item.id) }
}
