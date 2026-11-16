// 報表共用的加總:符合條件的交易 → 每一格(月份、分類、是否固定)的金額。
// 交易一律經過 ledger 的 listTransactions;每條分類分錄用交易當天的匯率換成顯示幣別,
// 同一格先加總再取整數,報表上其他數字(各分類、各月、合計)都是這些整數相加,彼此對得上
import type { FinanceDb } from '../../db/index'
import type { SummaryCategory } from '../../lib/reports'
import type { TransactionFilter } from '../../lib/transactions'
import { FxRateMissingError, convert } from '../fx/index'
import { MAX_PAGE_SIZE, categoryFilterAccountIds, listTransactions } from '../ledger/list'
import { getCurrencyExponents, getDisplayCurrency, listAccounts } from '../ledger/lookups'

export type Cell = {
  // YYYY-MM,以 UTC 切
  month: string
  categoryId: number
  type: 'expense' | 'income'
  fixed: boolean
  // 顯示幣別的最小貨幣單位;支出為正、收入為正。collectTotals 回傳時已取整數
  amount: number
}

export type Totals = {
  currency: string
  accounts: ReturnType<typeof listAccounts>
  cells: Cell[]
  // 每個月算進去的交易筆數
  transactionsByMonth: Map<string, number>
  // 缺匯率、整筆沒有算進去的交易筆數
  missingRate: number
}

export function collectTotals(db: FinanceDb, filter: TransactionFilter): Totals {
  const display = getDisplayCurrency(db)
  const exponents = getCurrencyExponents(db)
  const target = { currency: display, exponent: exponents[display] ?? 2 }
  const accounts = listAccounts(db)
  // 有分類篩選時只加總那些分類的分錄(拆帳交易的其他分類不算)
  const onlyCategories = categoryFilterAccountIds(db, filter)

  const raw = new Map<string, Cell>()
  const transactionsByMonth = new Map<string, number>()
  let missingRate = 0

  let cursor: string | undefined
  do {
    const page = listTransactions(db, filter, { cursor, limit: MAX_PAGE_SIZE })
    for (const row of page.items) {
      const fixed = row.scheduledId !== null
      const date = row.occurredAt.slice(0, 10)
      const month = date.slice(0, 7)
      const parts: Cell[] = []
      try {
        for (const p of row.postings) {
          if (p.accountType !== 'expense' && p.accountType !== 'income') continue
          if (onlyCategories && !onlyCategories.includes(p.accountId)) continue
          // 支出分類:借方為正 = 花掉的錢;收入分類:貸方(負)取負號 = 收到的錢
          const sign = p.accountType === 'expense' ? 1 : -1
          const source = { currency: p.currency, exponent: exponents[p.currency] ?? 2 }
          parts.push({
            month,
            categoryId: p.accountId,
            type: p.accountType,
            // 固定與否只分支出;收入一律不算固定
            fixed: p.accountType === 'expense' && fixed,
            amount: sign * convert(db, p.amount, source, target, date),
          })
        }
      } catch (error) {
        if (!(error instanceof FxRateMissingError)) throw error
        // 一筆交易缺任何一個匯率就整筆不算,不留下算到一半的分錄
        missingRate += 1
        continue
      }
      if (!parts.length) continue
      transactionsByMonth.set(month, (transactionsByMonth.get(month) ?? 0) + 1)
      for (const part of parts) {
        const key = `${part.month}|${part.categoryId}|${part.fixed ? 1 : 0}`
        const cell = raw.get(key)
        if (cell) cell.amount += part.amount
        else raw.set(key, { ...part })
      }
    }
    cursor = page.nextCursor ?? undefined
  } while (cursor)

  const cells = [...raw.values()].map((cell) => ({ ...cell, amount: Math.round(cell.amount) }))
  return { currency: display, accounts, cells, transactionsByMonth, missingRate }
}

export type Amounts = { expense: { total: number; fixed: number; variable: number }; income: number; net: number }

// 一組格子 → 支出(固定 / 變動)、收入、淨額
export function amountsOf(cells: Cell[]): Amounts {
  let fixed = 0
  let variable = 0
  let income = 0
  for (const cell of cells) {
    if (cell.type === 'income') income += cell.amount
    else if (cell.fixed) fixed += cell.amount
    else variable += cell.amount
  }
  return { expense: { total: fixed + variable, fixed, variable }, income, net: income - fixed - variable }
}

// 一組格子 → 上層分組(上層含子分類),上層與子分類各自依金額由大到小;金額為 0 的不列
export function categoriesOf(cells: Cell[], accounts: Totals['accounts'], type: 'expense' | 'income'): SummaryCategory[] {
  const perCategory = new Map<number, number>()
  for (const cell of cells) {
    if (cell.type === type) perCategory.set(cell.categoryId, (perCategory.get(cell.categoryId) ?? 0) + cell.amount)
  }
  const byId = new Map(accounts.map((a) => [a.id, a]))
  const groups = new Map<number, SummaryCategory>()
  for (const [id, amount] of perCategory) {
    const account = byId.get(id)
    if (!account || amount === 0) continue
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
  const list = [...groups.values()]
  for (const group of list) group.children.sort((a, b) => b.amount - a.amount)
  return list.sort((a, b) => b.amount - a.amount)
}
