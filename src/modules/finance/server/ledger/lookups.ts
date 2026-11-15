// 帳本的參考資料(唯讀):帳戶與分類、收款人、幣別的小數位數、顯示幣別。
// 篩選選單與金額顯示用;標籤在 tags 模組
import { asc, eq, sql } from 'drizzle-orm'
import type { FinanceConn } from '../../db/index'
import { financeAccounts, financeCurrencies, financePayees, financeSettings, financeTransactions } from '../../db/schema'
import type { FinanceLookups } from '../../lib/transactions'

// 設定裡沒有時用內部換算的基準
const DEFAULT_DISPLAY_CURRENCY = 'EUR'

export function getDisplayCurrency(db: FinanceConn): string {
  const row = db
    .select({ value: financeSettings.value })
    .from(financeSettings)
    .where(eq(financeSettings.key, 'display_currency'))
    .get()
  return row?.value ?? DEFAULT_DISPLAY_CURRENCY
}

// 幣別 → 小數位數
export function getCurrencyExponents(db: FinanceConn): Record<string, number> {
  const rows = db.select({ code: financeCurrencies.code, exponent: financeCurrencies.exponent }).from(financeCurrencies).all()
  return Object.fromEntries(rows.map((r) => [r.code, r.exponent]))
}

// 全部帳戶(含分類),依類型內的順序
export function listAccounts(db: FinanceConn): FinanceLookups['accounts'] {
  return db
    .select({
      id: financeAccounts.id,
      name: financeAccounts.name,
      type: financeAccounts.type,
      subtype: financeAccounts.subtype,
      parentId: financeAccounts.parentId,
      currency: financeAccounts.currency,
      isActive: financeAccounts.isActive,
    })
    .from(financeAccounts)
    .orderBy(asc(financeAccounts.type), asc(financeAccounts.sortOrder), asc(financeAccounts.id))
    .all()
}

// 收款人與各自的交易筆數(篩選選單的「常用」用筆數排),依名稱排序
export function listPayees(db: FinanceConn): FinanceLookups['payees'] {
  return db
    .select({
      id: financePayees.id,
      name: financePayees.name,
      transactionCount: sql<number>`COUNT(${financeTransactions.id})`,
    })
    .from(financePayees)
    .leftJoin(financeTransactions, eq(financeTransactions.payeeId, financePayees.id))
    .groupBy(financePayees.id)
    .orderBy(asc(financePayees.name))
    .all()
}
