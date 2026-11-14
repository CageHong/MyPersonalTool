// 自動分類:決定一筆新交易的分類(支出或收入那一側記到哪個帳戶)。
//
// 只決定、不寫入:loadClassifyContext 一次讀進需要的資料(只讀),decide 是純函式。
// 寫入由呼叫的人經過 ledger 做;自動分類只用在還沒有分類的交易,不覆蓋使用者給過的分類。
//
// 付出的順序(命中就停):
//   1. 週期項目(recurring 的配對;同時符合兩個以上時不配對,回報後繼續往下)
//   2. 對象規則(finance_rules,match_field = payee)
//   3. 對象歷史:同一個收款人,使用者給過的分類裡,最多的那個最上層分類佔比 ≥ 80%,
//      就記到那個最上層分類底下最常見的實際帳戶
//   4. 來源分類規則(finance_rules,match_field = source_category)
// 入帳只看來源分類規則。規則指到支出分類時,入帳等於沖銷那個分類的支出(退款、代墊收回)。
// 都沒有命中就維持未分類。
import { and, eq, gt, inArray, isNotNull } from 'drizzle-orm'
import type { FinanceConn } from '../../db/index'
import { financeAccounts, financePostings, financeRules, financeTransactions } from '../../db/schema'
import { loadScheduledItems, matchScheduled } from '../recurring/index'
import type { ScheduledItem } from '../recurring/index'

// 對象歷史:最多的最上層分類至少要佔這個比例才沿用
export const PAYEE_HISTORY_MIN_SHARE = 0.8

// 算對象歷史時採用的交易:分類是使用者給的(不含自動分類的結果,避免自己強化自己)
const USER_GIVEN_SOURCES = ['legacy', 'correction'] as const

type AccountType = (typeof financeAccounts.$inferSelect)['type']

export type CategorySource = 'scheduled' | 'rule' | 'payee_history' | 'source_category'

export type ClassifyContext = {
  scheduled: readonly ScheduledItem[]
  accountTypes: ReadonlyMap<number, AccountType>
  // 收款人 → 分類(同一個收款人有多條規則時取優先的)
  payeeRules: ReadonlyMap<number, number>
  // 來源給的分類文字 → 分類
  sourceRules: ReadonlyMap<string, number>
  // 收款人 → 對象歷史決定的分類(只收佔比夠的)
  history: ReadonlyMap<number, number>
}

export type ClassifyInput = {
  kind: 'out' | 'in'
  payeeId: number | null
  sourceCategory: string | null
  // UTC 的 ISO 8601
  occurredAt: string
  // 分類那一側的金額(每個幣別一筆,最小貨幣單位,正數)
  amounts: readonly { currency: string; amount: number }[]
}

export type Classification = {
  // null = 維持未分類
  accountId: number | null
  categorySource: CategorySource | null
  scheduledId: number | null
  // 同時符合的週期項目(兩個以上時才有;這時不配對)
  ambiguousScheduled: number[]
}

// 純函式:每個收款人的對象歷史決定。rows 是使用者給過的支出分錄(收款人、實際帳戶)
export function historyDecisions(
  rows: readonly { payeeId: number; accountId: number }[],
  topOf: (accountId: number) => number,
  minShare: number = PAYEE_HISTORY_MIN_SHARE,
): Map<number, number> {
  const byPayee = new Map<number, Map<number, number>>()
  for (const { payeeId, accountId } of rows) {
    const counts = byPayee.get(payeeId) ?? new Map<number, number>()
    counts.set(accountId, (counts.get(accountId) ?? 0) + 1)
    byPayee.set(payeeId, counts)
  }
  // 次數多的優先;同次數取 id 小的,結果才固定
  const best = (counts: Map<number, number>) =>
    [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]

  const decisions = new Map<number, number>()
  for (const [payeeId, accounts] of byPayee) {
    const tops = new Map<number, number>()
    let total = 0
    for (const [accountId, n] of accounts) {
      const top = topOf(accountId)
      tops.set(top, (tops.get(top) ?? 0) + n)
      total += n
    }
    const [top, n] = best(tops)
    if (n / total < minShare) continue
    const within = new Map([...accounts].filter(([accountId]) => topOf(accountId) === top))
    decisions.set(payeeId, best(within)[0])
  }
  return decisions
}

export function loadClassifyContext(db: FinanceConn): ClassifyContext {
  const accounts = db
    .select({ id: financeAccounts.id, type: financeAccounts.type, parentId: financeAccounts.parentId })
    .from(financeAccounts)
    .all()
  const parentOf = new Map(accounts.map((account) => [account.id, account.parentId]))
  const topOf = (accountId: number) => {
    let id = accountId
    for (let parent = parentOf.get(id); parent != null; parent = parentOf.get(id)) id = parent
    return id
  }

  const payeeRules = new Map<number, number>()
  const sourceRules = new Map<string, number>()
  const rules = db
    .select()
    .from(financeRules)
    .where(and(eq(financeRules.isActive, true), isNotNull(financeRules.assignAccountId)))
    .orderBy(financeRules.priority, financeRules.id)
    .all()
  for (const rule of rules) {
    if (rule.matchField === 'payee' && rule.payeeId !== null && !payeeRules.has(rule.payeeId)) {
      payeeRules.set(rule.payeeId, rule.assignAccountId!)
    }
    if (rule.matchField === 'source_category' && rule.matchValue !== null && !sourceRules.has(rule.matchValue)) {
      sourceRules.set(rule.matchValue, rule.assignAccountId!)
    }
  }

  const historyRows = db
    .select({ payeeId: financeTransactions.payeeId, accountId: financePostings.accountId })
    .from(financePostings)
    .innerJoin(financeTransactions, eq(financeTransactions.id, financePostings.transactionId))
    .innerJoin(financeAccounts, eq(financeAccounts.id, financePostings.accountId))
    .where(
      and(
        inArray(financeTransactions.categorySource, [...USER_GIVEN_SOURCES]),
        isNotNull(financeTransactions.payeeId),
        eq(financeAccounts.type, 'expense'),
        eq(financeAccounts.isSystem, false),
        // 只算借方;沖銷(退款、代墊收回)的貸方分錄不算一次「這個對象的分類」
        gt(financePostings.amount, 0),
      ),
    )
    .all()
    .filter((row) => row.payeeId !== null)
    .map((row) => ({ payeeId: row.payeeId!, accountId: row.accountId }))
  return {
    scheduled: loadScheduledItems(db),
    accountTypes: new Map(accounts.map((account) => [account.id, account.type])),
    payeeRules,
    sourceRules,
    history: historyDecisions(historyRows, topOf),
  }
}

// 純函式
export function decide(input: ClassifyInput, ctx: ClassifyContext): Classification {
  const result: Classification = {
    accountId: null,
    categorySource: null,
    scheduledId: null,
    ambiguousScheduled: [],
  }
  const isType = (accountId: number | undefined, ...types: AccountType[]) =>
    accountId !== undefined && types.includes(ctx.accountTypes.get(accountId)!)
  const assign = (accountId: number, categorySource: CategorySource, scheduledId: number | null = null) => ({
    ...result,
    accountId,
    categorySource,
    scheduledId,
  })

  const sourceRule =
    input.sourceCategory !== null ? ctx.sourceRules.get(input.sourceCategory) : undefined

  if (input.kind === 'in') {
    return isType(sourceRule, 'expense', 'income') ? assign(sourceRule!, 'source_category') : result
  }

  if (input.payeeId !== null) {
    if (input.amounts.length === 1) {
      const match = matchScheduled(ctx.scheduled, {
        payeeId: input.payeeId,
        currency: input.amounts[0].currency,
        amount: input.amounts[0].amount,
        occurredAt: input.occurredAt,
      })
      // 項目的分類不是支出分類時不用它(付出只記到支出分類),照下面的順序繼續
      if (match.status === 'matched' && isType(match.item.accountId, 'expense')) {
        return assign(match.item.accountId, 'scheduled', match.item.id)
      }
      if (match.status === 'ambiguous') result.ambiguousScheduled = match.itemIds
    }
    const rule = ctx.payeeRules.get(input.payeeId)
    if (isType(rule, 'expense')) return assign(rule!, 'rule')
    const history = ctx.history.get(input.payeeId)
    if (history !== undefined) return assign(history, 'payee_history')
  }
  return isType(sourceRule, 'expense') ? assign(sourceRule!, 'source_category') : result
}
