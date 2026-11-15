// 收款人:文字的正規化,以及「原始文字 → 收款人」的查詢與建立。
// 匯入的原始文字先正規化,再到別名表做完全相同的比對。
import { asc, eq, sql } from 'drizzle-orm'
import type { FinanceConn } from '../../db/index'
import {
  financePayeeAliases,
  financePayees,
  financeRules,
  financeScheduledTransactions,
  financeTransactions,
} from '../../db/schema'
import { NAME_MAX_LENGTH } from '../../lib/edit'
import type { PayeeAdminRow } from '../../lib/payees'
import { NotFoundError, ValidationError } from '../errors'
import { markV2Retired } from './settings'
import { toStoredTimestamp } from './time'

function collapse(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ')
}

// 去掉結尾的付款處理商後綴(例:「某商家 via 某處理商」)。suffixes 不含前面的空白,比對不分大小寫
function stripSuffix(text: string, suffixes: readonly string[]): string {
  const lower = text.toLowerCase()
  for (const suffix of suffixes) {
    const tail = ' ' + collapse(suffix).toLowerCase()
    if (tail.length > 1 && lower.length > tail.length && lower.endsWith(tail)) {
      return text.slice(0, text.length - tail.length)
    }
  }
  return text
}

// 別名表的鍵:去頭尾空白、連續空白合成一個、去掉後綴、轉小寫
export function normalizePayeeText(raw: string, suffixes: readonly string[]): string {
  return stripSuffix(collapse(raw), suffixes).toLowerCase()
}

// 第一次看到這個文字時,收款人的顯示名稱:保留原本的大小寫,只整理空白與後綴
export function payeeDisplayName(raw: string, suffixes: readonly string[]): string {
  return stripSuffix(collapse(raw), suffixes)
}

// 別名表裡這個文字對到的收款人;沒有就是 null。只查不寫
export function findPayeeByText(
  db: FinanceConn,
  raw: string,
  suffixes: readonly string[],
): number | null {
  const alias = normalizePayeeText(raw, suffixes)
  if (alias === '') return null
  const [row] = db
    .select({ payeeId: financePayeeAliases.payeeId })
    .from(financePayeeAliases)
    .where(eq(financePayeeAliases.alias, alias))
    .all()
  return row?.payeeId ?? null
}

// 這個文字會對到的既有收款人:別名表有就用,沒有就找同名的收款人;都沒有是 null。只查不寫。
// 跟 resolvePayee 用同一個順序,所以試跑時查到的就是套用時會用的
export function lookupPayee(
  db: FinanceConn,
  raw: string,
  suffixes: readonly string[],
): number | null {
  const known = findPayeeByText(db, raw, suffixes)
  if (known !== null) return known
  const name = payeeDisplayName(raw, suffixes)
  if (name === '') return null
  const [sameName] = db
    .select({ id: financePayees.id })
    .from(financePayees)
    .where(eq(financePayees.name, name))
    .all()
  return sameName?.id ?? null
}

// 原始文字 → 收款人 id。別名表有就用;沒有就新增別名,掛到同名的收款人,同名的也沒有才新增收款人。
// 整理後是空字串時回傳 null
export function resolvePayee(
  db: FinanceConn,
  raw: string,
  suffixes: readonly string[],
  now: string = new Date().toISOString(),
): number | null {
  const alias = normalizePayeeText(raw, suffixes)
  if (alias === '') return null
  return db.transaction((tx) => {
    const known = findPayeeByText(tx, raw, suffixes)
    if (known !== null) return known
    const name = payeeDisplayName(raw, suffixes)
    const [sameName] = tx
      .select({ id: financePayees.id })
      .from(financePayees)
      .where(eq(financePayees.name, name))
      .all()
    const payeeId =
      sameName?.id ??
      tx
        .insert(financePayees)
        .values({ name, createdAt: now })
        .returning({ id: financePayees.id })
        .all()[0].id
    tx.insert(financePayeeAliases).values({ alias, payeeId }).run()
    return payeeId
  })
}

// ── 管理(改名、合併、別名、刪除)───────────────────────────────────
// 每個寫入包在一個 DB transaction,並寫入「v2 已停用」(import-v2 重建會洗掉這些修改)

// 收款人清單(管理頁):交易筆數、別名、指到它的規則與週期項目數量,依名稱排序
export function listPayeesForAdmin(db: FinanceConn): PayeeAdminRow[] {
  const rows = db.all<Omit<PayeeAdminRow, 'aliases'>>(sql`
    SELECT p.id, p.name,
           (SELECT COUNT(*) FROM finance_transactions t WHERE t.payee_id = p.id) AS transactionCount,
           (SELECT COUNT(*) FROM finance_rules r WHERE r.payee_id = p.id) AS rules,
           (SELECT COUNT(*) FROM finance_scheduled_transactions s WHERE s.payee_id = p.id) AS scheduled
    FROM finance_payees p ORDER BY p.name`)
  const aliases = new Map<number, string[]>()
  for (const row of db.select().from(financePayeeAliases).orderBy(asc(financePayeeAliases.alias)).all()) {
    aliases.set(row.payeeId, [...(aliases.get(row.payeeId) ?? []), row.alias])
  }
  return rows.map((row) => ({ ...row, aliases: aliases.get(row.id) ?? [] }))
}

function loadPayee(tx: FinanceConn, id: number) {
  const [payee] = tx.select().from(financePayees).where(eq(financePayees.id, id)).all()
  if (!payee) throw new NotFoundError('Payee', id)
  return payee
}

export function renamePayee(db: FinanceConn, id: number, rawName: string, now: string = new Date().toISOString()): void {
  db.transaction((tx) => {
    loadPayee(tx, id)
    const name = rawName.trim()
    if (name === '') throw new ValidationError({ name: 'required' })
    if (name.length > NAME_MAX_LENGTH) throw new ValidationError({ name: 'too_long' })
    const [same] = tx.select({ id: financePayees.id }).from(financePayees).where(eq(financePayees.name, name)).all()
    if (same && same.id !== id) throw new ValidationError({ name: 'duplicate' })
    tx.update(financePayees).set({ name }).where(eq(financePayees.id, id)).run()
    markV2Retired(tx, toStoredTimestamp(now))
  })
}

// 合併:交易、別名、規則、週期項目改指向目標,再刪掉來源
export function mergePayee(db: FinanceConn, sourceId: number, targetId: number, now: string = new Date().toISOString()): void {
  db.transaction((tx) => {
    loadPayee(tx, sourceId)
    if (sourceId === targetId) throw new ValidationError({ targetId: 'self' })
    const [target] = tx.select({ id: financePayees.id }).from(financePayees).where(eq(financePayees.id, targetId)).all()
    if (!target) throw new ValidationError({ targetId: 'not_found' })
    tx.update(financeTransactions).set({ payeeId: targetId }).where(eq(financeTransactions.payeeId, sourceId)).run()
    tx.update(financePayeeAliases).set({ payeeId: targetId }).where(eq(financePayeeAliases.payeeId, sourceId)).run()
    tx.update(financeRules).set({ payeeId: targetId }).where(eq(financeRules.payeeId, sourceId)).run()
    tx.update(financeScheduledTransactions)
      .set({ payeeId: targetId })
      .where(eq(financeScheduledTransactions.payeeId, sourceId))
      .run()
    tx.delete(financePayees).where(eq(financePayees.id, sourceId)).run()
    markV2Retired(tx, toStoredTimestamp(now))
  })
}

// 刪除:沒有交易、規則、週期項目用到才行(別名一起刪)
export function deletePayee(db: FinanceConn, id: number, now: string = new Date().toISOString()): void {
  db.transaction((tx) => {
    loadPayee(tx, id)
    const used = (table: string, column: string) =>
      tx.all<{ n: number }>(sql.raw(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ${Number(id)}`))[0].n
    if (used('finance_transactions', 'payee_id')) throw new ValidationError({ payee: 'has_transactions' })
    if (used('finance_rules', 'payee_id') || used('finance_scheduled_transactions', 'payee_id')) {
      throw new ValidationError({ payee: 'in_use' })
    }
    tx.delete(financePayees).where(eq(financePayees.id, id)).run()
    markV2Retired(tx, toStoredTimestamp(now))
  })
}

// 別名移到另一個收款人(匯入時這個寫法之後對到新的收款人;已經匯入的交易不動)
export function moveAlias(db: FinanceConn, alias: string, payeeId: number, now: string = new Date().toISOString()): void {
  db.transaction((tx) => {
    const [row] = tx.select().from(financePayeeAliases).where(eq(financePayeeAliases.alias, alias)).all()
    if (!row) throw new ValidationError({ alias: 'not_found' })
    loadPayee(tx, payeeId)
    tx.update(financePayeeAliases).set({ payeeId }).where(eq(financePayeeAliases.alias, alias)).run()
    markV2Retired(tx, toStoredTimestamp(now))
  })
}

// 刪除別名(之後匯入這個寫法會重新比對:找同名的收款人,沒有就新增)
export function deleteAlias(db: FinanceConn, alias: string, now: string = new Date().toISOString()): void {
  db.transaction((tx) => {
    const deleted = tx.delete(financePayeeAliases).where(eq(financePayeeAliases.alias, alias)).returning().all()
    if (!deleted.length) throw new ValidationError({ alias: 'not_found' })
    markV2Retired(tx, toStoredTimestamp(now))
  })
}
