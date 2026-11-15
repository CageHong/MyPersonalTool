// 規則表(finance_rules)的管理:新增、修改、停用、排優先順序、刪除。
// 決定分類(index.ts)只讀規則;規則的寫入只在這裡。
// 對象規則只用在付出,所以只能指到支出分類;來源分類規則可以指到支出或收入分類(入帳指到支出 = 沖銷)。
// 優先順序:同一種(對象 / 來源分類)裡 priority 小的優先,上移下移時把那一種重新編成 0、1、2…
import { asc, eq, sql } from 'drizzle-orm'
import type { FinanceConn } from '../../db/index'
import { financeAccounts, financePayees, financeRules } from '../../db/schema'
import { NAME_MAX_LENGTH } from '../../lib/edit'
import type { RuleInput, RuleRow, RuleUpdate } from '../../lib/rules'
import { NotFoundError, ValidationError } from '../errors'
import { markV2Retired } from '../ledger/settings'
import { toStoredTimestamp } from '../ledger/time'

export function listRules(db: FinanceConn): RuleRow[] {
  return db
    .all<Omit<RuleRow, 'isActive'> & { isActive: number }>(sql`
      SELECT r.id, r.match_field AS matchField, r.payee_id AS payeeId, p.name AS payeeName,
             r.match_value AS matchValue, r.assign_account_id AS assignAccountId,
             CASE WHEN parent.name IS NULL THEN a.name ELSE parent.name || ' / ' || a.name END AS assignAccountName,
             r.priority, r.is_active AS isActive
      FROM finance_rules r
      LEFT JOIN finance_payees p ON p.id = r.payee_id
      LEFT JOIN finance_accounts a ON a.id = r.assign_account_id
      LEFT JOIN finance_accounts parent ON parent.id = a.parent_id
      ORDER BY r.match_field, r.priority, r.id`)
    .map((row) => ({ ...row, isActive: Boolean(row.isActive) }))
}

function checkTarget(tx: FinanceConn, matchField: RuleInput['matchField'], accountId: number, fields: Record<string, string>) {
  const [account] = tx.select().from(financeAccounts).where(eq(financeAccounts.id, accountId)).all()
  if (!account) fields.assignAccountId = 'not_found'
  else if (matchField === 'payee' && account.type !== 'expense') fields.assignAccountId = 'type_mismatch'
  else if (account.type !== 'expense' && account.type !== 'income') fields.assignAccountId = 'type_mismatch'
}

function checkPayee(tx: FinanceConn, payeeId: number, fields: Record<string, string>) {
  const [payee] = tx.select({ id: financePayees.id }).from(financePayees).where(eq(financePayees.id, payeeId)).all()
  if (!payee) fields.payeeId = 'not_found'
}

function checkValue(raw: string, fields: Record<string, string>): string {
  const value = raw.trim()
  if (value === '') fields.matchValue = 'required'
  else if (value.length > NAME_MAX_LENGTH) fields.matchValue = 'too_long'
  return value
}

export function createRule(db: FinanceConn, input: RuleInput, now: string = new Date().toISOString()): number {
  return db.transaction((tx) => {
    const fields: Record<string, string> = {}
    let matchValue: string | null = null
    if (input.matchField === 'payee') {
      if (input.payeeId === null) fields.payeeId = 'required'
      else checkPayee(tx, input.payeeId, fields)
    } else {
      matchValue = checkValue(input.matchValue ?? '', fields)
    }
    checkTarget(tx, input.matchField, input.assignAccountId, fields)
    if (Object.keys(fields).length) throw new ValidationError(fields)
    // 排在同一種的最後(優先順序最低)
    const [last] = tx
      .select({ max: sql<number | null>`MAX(${financeRules.priority})` })
      .from(financeRules)
      .where(eq(financeRules.matchField, input.matchField))
      .all()
    const [{ id }] = tx
      .insert(financeRules)
      .values({
        matchField: input.matchField,
        payeeId: input.matchField === 'payee' ? input.payeeId : null,
        matchValue,
        assignAccountId: input.assignAccountId,
        priority: (last?.max ?? -1) + 1,
        isActive: input.isActive,
        createdAt: toStoredTimestamp(now),
      })
      .returning({ id: financeRules.id })
      .all()
    markV2Retired(tx, toStoredTimestamp(now))
    return id
  })
}

function loadRule(tx: FinanceConn, id: number) {
  const [rule] = tx.select().from(financeRules).where(eq(financeRules.id, id)).all()
  if (!rule) throw new NotFoundError('Rule', id)
  return rule
}

export function updateRule(db: FinanceConn, id: number, patch: RuleUpdate, now: string = new Date().toISOString()): void {
  db.transaction((tx) => {
    const rule = loadRule(tx, id)
    const fields: Record<string, string> = {}
    const set: Partial<typeof financeRules.$inferInsert> = {}
    if (patch.payeeId !== undefined) {
      if (rule.matchField !== 'payee') fields.payeeId = 'not_payee_rule'
      else checkPayee(tx, patch.payeeId, fields)
      set.payeeId = patch.payeeId
    }
    if (patch.matchValue !== undefined) {
      if (rule.matchField !== 'source_category') fields.matchValue = 'not_source_rule'
      else set.matchValue = checkValue(patch.matchValue, fields)
    }
    if (patch.assignAccountId !== undefined) {
      checkTarget(tx, rule.matchField, patch.assignAccountId, fields)
      set.assignAccountId = patch.assignAccountId
    }
    if (patch.isActive !== undefined) set.isActive = patch.isActive
    if (Object.keys(fields).length) throw new ValidationError(fields)
    if (Object.keys(set).length) {
      tx.update(financeRules).set(set).where(eq(financeRules.id, id)).run()
      markV2Retired(tx, toStoredTimestamp(now))
    }
  })
}

export function moveRule(db: FinanceConn, id: number, direction: 'up' | 'down', now: string = new Date().toISOString()): void {
  db.transaction((tx) => {
    const rule = loadRule(tx, id)
    const ids = tx
      .select({ id: financeRules.id })
      .from(financeRules)
      .where(eq(financeRules.matchField, rule.matchField))
      .orderBy(asc(financeRules.priority), asc(financeRules.id))
      .all()
      .map((row) => row.id)
    const index = ids.indexOf(id)
    const target = direction === 'up' ? index - 1 : index + 1
    if (target < 0 || target >= ids.length) return
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    ids.forEach((ruleId, priority) => {
      tx.update(financeRules).set({ priority }).where(eq(financeRules.id, ruleId)).run()
    })
    markV2Retired(tx, toStoredTimestamp(now))
  })
}

export function deleteRule(db: FinanceConn, id: number, now: string = new Date().toISOString()): void {
  db.transaction((tx) => {
    loadRule(tx, id)
    tx.delete(financeRules).where(eq(financeRules.id, id)).run()
    markV2Retired(tx, toStoredTimestamp(now))
  })
}
