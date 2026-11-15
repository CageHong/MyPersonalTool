// 帳戶餘額。側欄、群組合計、淨值、可動用資金、信用卡可用餘額、報表,一律從這裡取餘額,
// 不自己寫分錄加總:之後投資帳戶的餘額會改成「持股 × 價格 + 現金」,到時候只改這個檔。
//
// 只算 asset / liability:這兩種帳戶幣別固定,餘額是單一幣別的一個數字(最小貨幣單位)。
// 分類(expense / income)可以收多種幣別,沒有「餘額」,期間合計屬於報表。
import { and, eq, inArray, lte, sql } from 'drizzle-orm'
import type { FinanceDb } from '../../db/index'
import { financeAccounts, financePostings, financeTransactions } from '../../db/schema'
import { ValidationError } from '../errors'

export type AccountBalance = {
  accountId: number
  currency: string
  // 最小貨幣單位;asset 正數 = 有錢,liability 負數 = 欠款
  amount: number
}

export class NotBalanceAccountError extends Error {
  constructor(public readonly accountId: number) {
    super(`帳戶 ${accountId} 不存在,或不是 asset / liability`)
  }
}

// 所有 asset / liability 帳戶的餘額(沒有分錄的帳戶是 0)。
// asOf(YYYY-MM-DD,以 UTC 切日):只算到那一天為止的交易;不給 = 全部
export function getAccountBalances(db: FinanceDb, asOf?: string): AccountBalance[] {
  // 日期條件要放在 JOIN 上:放在 WHERE 會把沒有分錄的帳戶濾掉
  const inRange = asOf
    ? and(
        eq(financeTransactions.id, financePostings.transactionId),
        lte(sql`substr(${financeTransactions.occurredAt}, 1, 10)`, asOf),
      )
    : eq(financeTransactions.id, financePostings.transactionId)
  return db
    .select({
      accountId: financeAccounts.id,
      currency: sql<string>`${financeAccounts.currency}`,
      amount: sql<number>`COALESCE(SUM(CASE WHEN ${financeTransactions.id} IS NOT NULL THEN ${financePostings.amount} END), 0)`,
    })
    .from(financeAccounts)
    .leftJoin(financePostings, eq(financePostings.accountId, financeAccounts.id))
    .leftJoin(financeTransactions, inRange)
    .where(inArray(financeAccounts.type, ['asset', 'liability']))
    .groupBy(financeAccounts.id)
    .orderBy(financeAccounts.id)
    .all()
}

// 單一帳戶的餘額
export function getAccountBalance(db: FinanceDb, accountId: number, asOf?: string): AccountBalance {
  const balance = getAccountBalances(db, asOf).find((row) => row.accountId === accountId)
  if (!balance) throw new NotBalanceAccountError(accountId)
  return balance
}

// 給 API 用(對帳調整):帳戶不是 asset / liability、日期格式不對時是 ValidationError
export function getAccountBalanceForInput(db: FinanceDb, accountId: number, asOf?: string): AccountBalance {
  if (asOf !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new ValidationError({ asOf: 'invalid' })
  try {
    return getAccountBalance(db, accountId, asOf)
  } catch (error) {
    if (error instanceof NotBalanceAccountError) throw new ValidationError({ account: 'not_balance_account' })
    throw error
  }
}

