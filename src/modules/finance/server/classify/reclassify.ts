// 重新分類未分類的交易:用目前的規則、週期項目、對象歷史,為帳本裡還記在「未分類」/「未分類收入」的交易決定分類。
// 先預覽(只讀),使用者勾選後才寫入;寫入經過 ledger。已經分類的交易不動(自動分類不覆蓋使用者給的分類)
import { sql } from 'drizzle-orm'
import type { FinanceConn } from '../../db/index'
import type { ReclassifyItem, ReclassifyPreview } from '../../lib/rules'
import { getSystemAccounts } from '../ledger/accounts'
import { markV2Retired } from '../ledger/settings'
import { toStoredTimestamp } from '../ledger/time'
import { assignCategory } from '../ledger/transactions'
import { decide, loadClassifyContext } from './index'

type Candidate = ReclassifyItem & { fromAccountId: number; scheduledId: number | null }

function candidates(db: FinanceConn): { items: Candidate[]; unmatched: number } {
  const system = getSystemAccounts(db)
  const rows = db.all<{
    transactionId: number
    occurredAt: string
    payeeId: number | null
    payee: string | null
    importMeta: string | null
    accountId: number
    amount: number
    currency: string
  }>(sql`
    SELECT t.id AS transactionId, t.occurred_at AS occurredAt, t.payee_id AS payeeId, py.name AS payee,
           t.import_meta AS importMeta, p.account_id AS accountId, p.amount, p.currency
    FROM finance_postings p
    JOIN finance_transactions t ON t.id = p.transaction_id
    LEFT JOIN finance_payees py ON py.id = t.payee_id
    WHERE p.account_id IN (${system.uncategorizedExpense}, ${system.uncategorizedIncome})
    ORDER BY t.occurred_at DESC, t.id DESC, p.sort_order`)
  // 一筆交易只看第一條未分類分錄的那一種(付出 / 入帳),同一種的分錄金額一起算
  const byTransaction = new Map<number, typeof rows>()
  for (const row of rows) {
    const list = byTransaction.get(row.transactionId) ?? []
    if (!list.length || list[0].accountId === row.accountId) list.push(row)
    byTransaction.set(row.transactionId, list)
  }
  const ctx = loadClassifyContext(db)
  const names = new Map(
    db
      .all<{ id: number; name: string }>(sql`
        SELECT a.id, CASE WHEN p.name IS NULL THEN a.name ELSE p.name || ' / ' || a.name END AS name
        FROM finance_accounts a LEFT JOIN finance_accounts p ON p.id = a.parent_id`)
      .map((row) => [row.id, row.name]),
  )
  const items: Candidate[] = []
  let unmatched = 0
  for (const [transactionId, list] of byTransaction) {
    const first = list[0]
    const kind = first.accountId === system.uncategorizedExpense ? 'out' : 'in'
    let sourceCategory: string | null = null
    try {
      const meta = first.importMeta ? (JSON.parse(first.importMeta) as { source_category?: unknown }) : null
      if (typeof meta?.source_category === 'string') sourceCategory = meta.source_category
    } catch {
      // 壞掉的 import_meta 當作沒有來源分類
    }
    const totals = new Map<string, number>()
    for (const row of list) totals.set(row.currency, (totals.get(row.currency) ?? 0) + Math.abs(row.amount))
    const decision = decide(
      {
        kind,
        payeeId: first.payeeId,
        sourceCategory,
        occurredAt: first.occurredAt,
        amounts: [...totals].map(([currency, amount]) => ({ currency, amount })),
      },
      ctx,
    )
    if (decision.accountId === null || decision.categorySource === null) {
      unmatched++
      continue
    }
    items.push({
      transactionId,
      occurredAt: first.occurredAt,
      payee: first.payee,
      amount: Math.abs(first.amount),
      currency: first.currency,
      accountId: decision.accountId,
      accountName: names.get(decision.accountId) ?? `#${decision.accountId}`,
      categorySource: decision.categorySource,
      fromAccountId: first.accountId,
      scheduledId: decision.scheduledId,
    })
  }
  return { items, unmatched }
}

export function planReclassify(db: FinanceConn): ReclassifyPreview {
  const { items, unmatched } = candidates(db)
  return {
    items: items.map((item) => ({
      transactionId: item.transactionId,
      occurredAt: item.occurredAt,
      payee: item.payee,
      amount: item.amount,
      currency: item.currency,
      accountId: item.accountId,
      accountName: item.accountName,
      categorySource: item.categorySource,
    })),
    unmatched,
  }
}

// 只寫入選中的交易;寫入前用最新的資料重算一次,已經不在預覽裡的(別處分類過了)跳過
export function applyReclassify(
  db: FinanceConn,
  transactionIds: readonly number[],
  now: string = new Date().toISOString(),
): { applied: number; skipped: number } {
  return db.transaction((tx) => {
    const wanted = new Set(transactionIds)
    const plan = candidates(tx).items.filter((item) => wanted.has(item.transactionId))
    for (const item of plan) {
      assignCategory(tx, item.transactionId, {
        fromAccountId: item.fromAccountId,
        toAccountId: item.accountId,
        categorySource: item.categorySource,
        scheduledId: item.scheduledId,
      }, now)
    }
    if (plan.length) markV2Retired(tx, toStoredTimestamp(now))
    return { applied: plan.length, skipped: wanted.size - plan.length }
  })
}
