// 期間摘要(唯讀):符合一組篩選條件的交易,支出(固定 / 變動)、收入、淨額、各分類。
// 交易一律經過 ledger 的 listTransactions 取得,篩選規則不另寫一份。語意見 docs/finance/reports.md
import type { FinanceDb } from '../../db/index'
import type { SummaryCategory, TransactionSummary } from '../../lib/reports'
import type { TransactionFilter } from '../../lib/transactions'
import { FxRateMissingError, convert } from '../fx/index'
import { MAX_PAGE_SIZE, categoryFilterAccountIds, listTransactions } from '../ledger/list'
import { getCurrencyExponents, getDisplayCurrency, listAccounts } from '../ledger/lookups'

type Bucket = { categoryId: number; fixed: boolean; amount: number }

export function summarizeTransactions(db: FinanceDb, filter: TransactionFilter): TransactionSummary {
  const display = getDisplayCurrency(db)
  const exponents = getCurrencyExponents(db)
  const target = { currency: display, exponent: exponents[display] ?? 2 }
  // 有分類篩選時只加總那些分類的分錄(拆帳交易的其他分類不算)
  const onlyCategories = categoryFilterAccountIds(db, filter)

  // (分類, 是否固定) → 未取整數的合計;最後每一格各自取整數,其他數字都是這些整數相加,畫面上的數字彼此對得上
  const buckets = new Map<string, Bucket>()
  let transactionCount = 0
  let missingRate = 0

  let cursor: string | undefined
  do {
    const page = listTransactions(db, filter, { cursor, limit: MAX_PAGE_SIZE })
    for (const row of page.items) {
      const fixed = row.scheduledId !== null
      const date = row.occurredAt.slice(0, 10)
      const parts: Bucket[] = []
      try {
        for (const p of row.postings) {
          if (p.accountType !== 'expense' && p.accountType !== 'income') continue
          if (onlyCategories && !onlyCategories.includes(p.accountId)) continue
          // 支出分類:借方為正 = 花掉的錢;收入分類:貸方(負)取負號 = 收到的錢
          const sign = p.accountType === 'expense' ? 1 : -1
          const source = { currency: p.currency, exponent: exponents[p.currency] ?? 2 }
          parts.push({ categoryId: p.accountId, fixed, amount: sign * convert(db, p.amount, source, target, date) })
        }
      } catch (error) {
        if (!(error instanceof FxRateMissingError)) throw error
        // 一筆交易缺任何一個匯率就整筆不算,不留下算到一半的分錄
        missingRate += 1
        continue
      }
      if (!parts.length) continue
      transactionCount += 1
      for (const part of parts) {
        const key = `${part.categoryId}:${part.fixed ? 1 : 0}`
        const bucket = buckets.get(key)
        if (bucket) bucket.amount += part.amount
        else buckets.set(key, { ...part })
      }
    }
    cursor = page.nextCursor ?? undefined
  } while (cursor)

  const accounts = listAccounts(db)
  const byId = new Map(accounts.map((a) => [a.id, a]))
  let fixedTotal = 0
  let variableTotal = 0
  let incomeTotal = 0
  const perCategory = new Map<number, number>()
  for (const bucket of buckets.values()) {
    const amount = Math.round(bucket.amount)
    perCategory.set(bucket.categoryId, (perCategory.get(bucket.categoryId) ?? 0) + amount)
    if (byId.get(bucket.categoryId)?.type === 'income') incomeTotal += amount
    else if (bucket.fixed) fixedTotal += amount
    else variableTotal += amount
  }

  const expenseTotal = fixedTotal + variableTotal
  return {
    currency: display,
    expense: { total: expenseTotal, fixed: fixedTotal, variable: variableTotal },
    income: incomeTotal,
    net: incomeTotal - expenseTotal,
    expenseCategories: groupCategories(perCategory, accounts, 'expense'),
    incomeCategories: groupCategories(perCategory, accounts, 'income'),
    transactionCount,
    missingRate,
  }
}

// 分類合計 → 上層分組(上層含子分類),上層與子分類各自依金額由大到小;金額為 0 的不列
function groupCategories(
  perCategory: Map<number, number>,
  accounts: ReturnType<typeof listAccounts>,
  type: 'expense' | 'income',
): SummaryCategory[] {
  const byId = new Map(accounts.map((a) => [a.id, a]))
  const groups = new Map<number, SummaryCategory>()
  for (const [id, amount] of perCategory) {
    const account = byId.get(id)
    if (!account || account.type !== type || amount === 0) continue
    const top = account.parentId === null ? account : byId.get(account.parentId)
    if (!top) continue
    let group = groups.get(top.id)
    if (!group) {
      group = { id: top.id, name: top.name, amount: 0, children: [] }
      groups.set(top.id, group)
    }
    group.amount += amount
    if (account.parentId !== null) group.children.push({ id: account.id, name: account.name, amount })
  }
  const list = [...groups.values()].filter((g) => g.amount !== 0 || g.children.length)
  for (const group of list) group.children.sort((a, b) => b.amount - a.amount)
  return list.sort((a, b) => b.amount - a.amount)
}
