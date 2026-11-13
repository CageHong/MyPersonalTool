// 帳戶的查詢:系統帳戶,以及用來源系統的帳戶代碼找帳戶。
import { and, eq, isNotNull } from 'drizzle-orm'
import type { FinanceConn } from '../../db/index'
import { financeAccounts } from '../../db/schema'

// 系統帳戶(isSystem):每個資料庫各有一個,用名稱 + 類型辨認
const SYSTEM_ACCOUNTS = {
  uncategorizedExpense: { name: '未分類', type: 'expense' },
  uncategorizedIncome: { name: '未分類收入', type: 'income' },
  fee: { name: '手續費', type: 'expense' },
  exchange: { name: '換匯', type: 'equity' },
} as const

export type SystemAccountKey = keyof typeof SYSTEM_ACCOUNTS
export type SystemAccounts = Record<SystemAccountKey, number>

export class MissingSystemAccountError extends Error {
  constructor(name: string) {
    super(`找不到系統帳戶「${name}」`)
    this.name = 'MissingSystemAccountError'
  }
}

// 系統帳戶的 id
export function getSystemAccounts(db: FinanceConn): SystemAccounts {
  const rows = db
    .select({ id: financeAccounts.id, name: financeAccounts.name, type: financeAccounts.type })
    .from(financeAccounts)
    .where(eq(financeAccounts.isSystem, true))
    .all()
  const find = (key: SystemAccountKey) => {
    const wanted = SYSTEM_ACCOUNTS[key]
    const row = rows.find((r) => r.name === wanted.name && r.type === wanted.type)
    if (!row) throw new MissingSystemAccountError(wanted.name)
    return row.id
  }
  return {
    uncategorizedExpense: find('uncategorizedExpense'),
    uncategorizedIncome: find('uncategorizedIncome'),
    fee: find('fee'),
    exchange: find('exchange'),
  }
}

export type LegacyAccount = { id: number; legacyId: string; currency: string }

// 有來源系統代碼(legacyId)的 asset / liability 帳戶;匯入時用代碼對到帳戶
export function getAccountsWithLegacyId(db: FinanceConn): LegacyAccount[] {
  return db
    .select({
      id: financeAccounts.id,
      legacyId: financeAccounts.legacyId,
      currency: financeAccounts.currency,
    })
    .from(financeAccounts)
    .where(and(isNotNull(financeAccounts.legacyId), isNotNull(financeAccounts.currency)))
    .all()
    .map((row) => ({ id: row.id, legacyId: row.legacyId!, currency: row.currency! }))
}
