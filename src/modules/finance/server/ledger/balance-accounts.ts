// 資產 / 負債帳戶的管理:新增、改名、改子類型、封存。幣別建立後不能改(分錄的幣別要跟帳戶一致)。
// 群組、信用卡明細、刪除帳戶在里程碑 c。每個寫入包在一個 DB transaction,並寫入「v2 已停用」
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { FinanceConn, FinanceDb } from '../../db/index'
import { financeAccounts, financeCurrencies } from '../../db/schema'
import { SUBTYPES } from '../../lib/balance-accounts'
import type { BalanceAccountInput, BalanceAccountRow, BalanceAccountType, BalanceAccountUpdate } from '../../lib/balance-accounts'
import { NAME_MAX_LENGTH } from '../../lib/edit'
import { NotFoundError, ValidationError } from '../errors'
import { getAccountBalances } from './balances'
import { markV2Retired } from './settings'
import { toStoredTimestamp } from './time'

export function listBalanceAccounts(db: FinanceDb): BalanceAccountRow[] {
  const balances = new Map(getAccountBalances(db).map((b) => [b.accountId, b.amount]))
  return db
    .all<Omit<BalanceAccountRow, 'balance' | 'isActive'> & { isActive: number }>(sql`
      SELECT a.id, a.name, a.type, a.subtype, a.currency, a.is_active AS isActive,
             (SELECT COUNT(DISTINCT p.transaction_id) FROM finance_postings p WHERE p.account_id = a.id) AS transactions
      FROM finance_accounts a WHERE a.type IN ('asset', 'liability')
      ORDER BY a.type, a.is_active DESC, a.name`)
    .map((row) => ({ ...row, isActive: Boolean(row.isActive), balance: balances.get(row.id) ?? 0 }))
}

function checkSubtype(type: BalanceAccountType, subtype: string, fields: Record<string, string>) {
  if (!(SUBTYPES[type] as readonly { key: string }[]).some((s) => s.key === subtype)) fields.subtype = 'invalid'
}

function checkName(db: FinanceConn, type: BalanceAccountType, raw: string, fields: Record<string, string>, selfId?: number) {
  const name = raw.trim()
  if (name === '') fields.name = 'required'
  else if (name.length > NAME_MAX_LENGTH) fields.name = 'too_long'
  else {
    const same = db
      .select({ id: financeAccounts.id })
      .from(financeAccounts)
      .where(and(eq(financeAccounts.type, type), isNull(financeAccounts.parentId), eq(financeAccounts.name, name)))
      .all()
    if (same.some((row) => row.id !== selfId)) fields.name = 'duplicate'
  }
  return name
}

export function createBalanceAccount(db: FinanceDb, input: BalanceAccountInput, now: string = new Date().toISOString()): number {
  return db.transaction((tx) => {
    const fields: Record<string, string> = {}
    if (input.type !== 'asset' && input.type !== 'liability') throw new ValidationError({ type: 'invalid' })
    const name = checkName(tx, input.type, input.name, fields)
    checkSubtype(input.type, input.subtype, fields)
    const currency = tx.select().from(financeCurrencies).where(eq(financeCurrencies.code, input.currency)).all()
    if (!currency.length) fields.currency = 'not_found'
    if (Object.keys(fields).length) throw new ValidationError(fields)
    const [{ id }] = tx
      .insert(financeAccounts)
      .values({ name, type: input.type, subtype: input.subtype, currency: input.currency, createdAt: toStoredTimestamp(now) })
      .returning({ id: financeAccounts.id })
      .all()
    markV2Retired(tx, toStoredTimestamp(now))
    return id
  })
}

export function updateBalanceAccount(
  db: FinanceDb,
  id: number,
  patch: BalanceAccountUpdate,
  now: string = new Date().toISOString(),
): void {
  db.transaction((tx) => {
    const [account] = tx
      .select()
      .from(financeAccounts)
      .where(and(eq(financeAccounts.id, id), inArray(financeAccounts.type, ['asset', 'liability'])))
      .all()
    if (!account) throw new NotFoundError('Account', id)
    const type = account.type as BalanceAccountType
    const fields: Record<string, string> = {}
    const set: Partial<typeof financeAccounts.$inferInsert> = {}
    if (patch.name !== undefined) set.name = checkName(tx, type, patch.name, fields, id)
    if (patch.subtype !== undefined) {
      checkSubtype(type, patch.subtype, fields)
      set.subtype = patch.subtype
    }
    if (patch.isActive !== undefined) set.isActive = patch.isActive
    if (Object.keys(fields).length) throw new ValidationError(fields)
    if (Object.keys(set).length) {
      tx.update(financeAccounts).set(set).where(eq(financeAccounts.id, id)).run()
      markV2Retired(tx, toStoredTimestamp(now))
    }
  })
}
