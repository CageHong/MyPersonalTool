// 分類(expense / income 帳戶)的管理:新增、改名、換上層、排序、封存、合併、刪除。
// 規則:系統分類(未分類、未分類收入、手續費)不能改名、換上層、封存、合併掉、刪除;類型不能改;只有兩層;
// 有交易的分類不能刪,只能封存或合併。合併 = 分錄、規則、週期項目改指向目標,再刪掉來源。
// 每個寫入都包在一個 DB transaction,並寫入「v2 已停用」(import-v2 重建會洗掉這些修改)
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import type { FinanceConn } from '../../db/index'
import { financeAccounts, financePostings, financeRules, financeScheduledTransactions } from '../../db/schema'
import { NAME_MAX_LENGTH } from '../../lib/edit'
import type { CategoryNode } from '../../lib/categories'
import { NotFoundError, ValidationError } from '../errors'
import { markV2Retired } from './settings'
import { toStoredTimestamp } from './transactions'

type CategoryType = 'expense' | 'income'
type Account = typeof financeAccounts.$inferSelect

// 每個分類被用到的次數
function usage(db: FinanceConn, accountId: number) {
  const count = (query: { n: number }[]) => query[0]?.n ?? 0
  return {
    postings: count(
      db.select({ n: sql<number>`COUNT(*)` }).from(financePostings).where(eq(financePostings.accountId, accountId)).all(),
    ),
    rules: count(
      db.select({ n: sql<number>`COUNT(*)` }).from(financeRules).where(eq(financeRules.assignAccountId, accountId)).all(),
    ),
    scheduled: count(
      db
        .select({ n: sql<number>`COUNT(*)` })
        .from(financeScheduledTransactions)
        .where(eq(financeScheduledTransactions.accountId, accountId))
        .all(),
    ),
  }
}

// 全部分類,上層後面接子分類(各自依 sort_order、id),附交易筆數(有分錄的交易)、規則與週期項目的數量
export function listCategories(db: FinanceConn): CategoryNode[] {
  const rows = db.all<{
    id: number
    name: string
    type: CategoryType
    parentId: number | null
    sortOrder: number
    isActive: number
    isSystem: number
    transactions: number
    rules: number
    scheduled: number
  }>(sql`
    SELECT a.id, a.name, a.type, a.parent_id AS parentId, a.sort_order AS sortOrder,
           a.is_active AS isActive, a.is_system AS isSystem,
           (SELECT COUNT(DISTINCT p.transaction_id) FROM finance_postings p WHERE p.account_id = a.id) AS transactions,
           (SELECT COUNT(*) FROM finance_rules r WHERE r.assign_account_id = a.id) AS rules,
           (SELECT COUNT(*) FROM finance_scheduled_transactions s WHERE s.account_id = a.id) AS scheduled
    FROM finance_accounts a
    WHERE a.type IN ('expense', 'income')
    ORDER BY a.type, a.sort_order, a.id`)
  const nodes = rows.map((r) => ({ ...r, isActive: Boolean(r.isActive), isSystem: Boolean(r.isSystem) }))
  const tops = nodes.filter((n) => n.parentId === null)
  return tops.flatMap((top) => [top, ...nodes.filter((n) => n.parentId === top.id)])
}

function load(tx: FinanceConn, id: number): Account & { type: CategoryType } {
  const [account] = tx.select().from(financeAccounts).where(eq(financeAccounts.id, id)).all()
  if (!account || (account.type !== 'expense' && account.type !== 'income')) throw new NotFoundError('Category', id)
  return account as Account & { type: CategoryType }
}

function checkName(raw: string, fields: Record<string, string>): string {
  const name = raw.trim()
  if (name === '') fields.name = 'required'
  else if (name.length > NAME_MAX_LENGTH) fields.name = 'too_long'
  return name
}

// 同類型、同一層已經有這個名稱(不含自己)
function nameTaken(tx: FinanceConn, type: CategoryType, parentId: number | null, name: string, exceptId?: number): boolean {
  return tx
    .select({ id: financeAccounts.id })
    .from(financeAccounts)
    .where(
      and(
        eq(financeAccounts.type, type),
        parentId === null ? isNull(financeAccounts.parentId) : eq(financeAccounts.parentId, parentId),
        eq(financeAccounts.name, name),
      ),
    )
    .all()
    .some((row) => row.id !== exceptId)
}

// 可以當上層的分類:同類型的最上層,不是系統分類、不是自己
function checkParent(
  tx: FinanceConn,
  type: CategoryType,
  parentId: number,
  fields: Record<string, string>,
  selfId?: number,
): void {
  const [parent] = tx.select().from(financeAccounts).where(eq(financeAccounts.id, parentId)).all()
  if (!parent) fields.parentId = 'not_found'
  else if (parent.type !== type) fields.parentId = 'type_mismatch'
  else if (parent.parentId !== null) fields.parentId = 'not_top_level'
  else if (parent.isSystem) fields.parentId = 'system'
  else if (parent.id === selfId) fields.parentId = 'self'
}

function children(tx: FinanceConn, id: number): Account[] {
  return tx.select().from(financeAccounts).where(eq(financeAccounts.parentId, id)).all()
}

function finish(tx: FinanceConn, now: string) {
  markV2Retired(tx, toStoredTimestamp(now))
}

export function createCategory(
  db: FinanceConn,
  input: { name: string; type: CategoryType; parentId: number | null },
  now: string = new Date().toISOString(),
): number {
  return db.transaction((tx) => {
    const fields: Record<string, string> = {}
    if (input.type !== 'expense' && input.type !== 'income') fields.type = 'invalid'
    const name = checkName(input.name, fields)
    if (input.parentId !== null) checkParent(tx, input.type, input.parentId, fields)
    if (!Object.keys(fields).length && nameTaken(tx, input.type, input.parentId, name)) fields.name = 'duplicate'
    if (Object.keys(fields).length) throw new ValidationError(fields)
    // 排在同一層的最後
    const [last] = tx
      .select({ max: sql<number | null>`MAX(${financeAccounts.sortOrder})` })
      .from(financeAccounts)
      .where(
        and(
          eq(financeAccounts.type, input.type),
          input.parentId === null ? isNull(financeAccounts.parentId) : eq(financeAccounts.parentId, input.parentId),
        ),
      )
      .all()
    const [{ id }] = tx
      .insert(financeAccounts)
      .values({
        name,
        type: input.type,
        parentId: input.parentId,
        sortOrder: (last?.max ?? -1) + 1,
        createdAt: toStoredTimestamp(now),
      })
      .returning({ id: financeAccounts.id })
      .all()
    finish(tx, now)
    return id
  })
}

// 改名、換上層(null = 變成最上層)、封存 / 取消封存。patch 裡沒有的不變
export function updateCategory(
  db: FinanceConn,
  id: number,
  patch: { name?: string; parentId?: number | null; isActive?: boolean },
  now: string = new Date().toISOString(),
): void {
  db.transaction((tx) => {
    const account = load(tx, id)
    const fields: Record<string, string> = {}
    const set: Partial<typeof financeAccounts.$inferInsert> = {}
    if (account.isSystem && Object.keys(patch).length) throw new ValidationError({ category: 'system' })

    const parentId = patch.parentId === undefined ? account.parentId : patch.parentId
    if (patch.parentId !== undefined && patch.parentId !== account.parentId) {
      if (patch.parentId !== null) {
        checkParent(tx, account.type, patch.parentId, fields, id)
        // 本身有子分類的不能放到別人底下(會變成三層)
        if (!fields.parentId && children(tx, id).length) fields.parentId = 'has_children'
      }
      set.parentId = patch.parentId
    }
    let name = account.name
    if (patch.name !== undefined) {
      name = checkName(patch.name, fields)
      set.name = name
    }
    if ((set.name !== undefined || set.parentId !== undefined) && !fields.name && !fields.parentId) {
      if (nameTaken(tx, account.type, parentId, name, id)) fields.name = 'duplicate'
    }
    if (patch.isActive !== undefined) set.isActive = patch.isActive
    if (Object.keys(fields).length) throw new ValidationError(fields)
    if (Object.keys(set).length) {
      tx.update(financeAccounts).set(set).where(eq(financeAccounts.id, id)).run()
      finish(tx, now)
    }
  })
}

// 在同一層裡上移或下移一格(重新編排同一層的 sort_order)
export function moveCategory(
  db: FinanceConn,
  id: number,
  direction: 'up' | 'down',
  now: string = new Date().toISOString(),
): void {
  db.transaction((tx) => {
    const account = load(tx, id)
    const siblings = tx
      .select({ id: financeAccounts.id })
      .from(financeAccounts)
      .where(
        and(
          eq(financeAccounts.type, account.type),
          account.parentId === null ? isNull(financeAccounts.parentId) : eq(financeAccounts.parentId, account.parentId),
        ),
      )
      .orderBy(asc(financeAccounts.sortOrder), asc(financeAccounts.id))
      .all()
      .map((row) => row.id)
    const index = siblings.indexOf(id)
    const target = direction === 'up' ? index - 1 : index + 1
    if (target < 0 || target >= siblings.length) return
    ;[siblings[index], siblings[target]] = [siblings[target], siblings[index]]
    siblings.forEach((siblingId, order) => {
      tx.update(financeAccounts).set({ sortOrder: order }).where(eq(financeAccounts.id, siblingId)).run()
    })
    finish(tx, now)
  })
}

// 合併:來源的分錄、規則、週期項目改指向目標,再刪掉來源
export function mergeCategory(
  db: FinanceConn,
  sourceId: number,
  targetId: number,
  now: string = new Date().toISOString(),
): void {
  db.transaction((tx) => {
    const source = load(tx, sourceId)
    const fields: Record<string, string> = {}
    if (source.isSystem) fields.category = 'system'
    if (children(tx, sourceId).length) fields.category = 'has_children'
    const [target] = tx.select().from(financeAccounts).where(eq(financeAccounts.id, targetId)).all()
    if (!target) fields.targetId = 'not_found'
    else if (target.id === sourceId) fields.targetId = 'self'
    else if (target.type !== source.type) fields.targetId = 'type_mismatch'
    if (Object.keys(fields).length) throw new ValidationError(fields)

    tx.update(financePostings).set({ accountId: targetId }).where(eq(financePostings.accountId, sourceId)).run()
    tx.update(financeRules).set({ assignAccountId: targetId }).where(eq(financeRules.assignAccountId, sourceId)).run()
    tx.update(financeScheduledTransactions)
      .set({ accountId: targetId })
      .where(eq(financeScheduledTransactions.accountId, sourceId))
      .run()
    tx.delete(financeAccounts).where(eq(financeAccounts.id, sourceId)).run()
    finish(tx, now)
  })
}

// 刪除:只有沒被任何分錄、規則、週期項目用到,也沒有子分類的才能刪
export function deleteCategory(db: FinanceConn, id: number, now: string = new Date().toISOString()): void {
  db.transaction((tx) => {
    const account = load(tx, id)
    if (account.isSystem) throw new ValidationError({ category: 'system' })
    const used = usage(tx, id)
    const fields: Record<string, string> = {}
    if (children(tx, id).length) fields.category = 'has_children'
    else if (used.postings) fields.category = 'has_transactions'
    else if (used.rules || used.scheduled) fields.category = 'in_use'
    if (Object.keys(fields).length) throw new ValidationError(fields)
    tx.delete(financeAccounts).where(eq(financeAccounts.id, id)).run()
    finish(tx, now)
  })
}
