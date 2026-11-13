// 去重 key:同一筆交易重複匯入時算出相同的字串。
// 有來源 ID 用 ID;沒有就用 日期(UTC)+ 金額 + 幣別,取第一筆變動。

import { canonicalDecimal } from './decimal'
import type { PendingTransaction } from './types'

export function dedupKey(tx: PendingTransaction): string {
  if (tx.externalId !== null) return `${tx.source}|id|${tx.externalId}`
  const [first] = tx.movements
  const date = tx.occurredAt.slice(0, 10)
  return `${tx.source}|${date}|${canonicalDecimal(first.amount)}|${first.currency}`
}
