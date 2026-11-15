// 交易的寫入。帳本裡寫入交易與分錄的地方只有這個檔;匯入、手動記帳、編輯都呼叫這裡。
//
// 不變量:表頭與分錄在同一個 DB transaction 裡寫入;提交前每個幣別的分錄加總為零。
import { and, eq, inArray } from 'drizzle-orm'
import type { FinanceConn } from '../../db/index'
import {
  financeAccounts,
  financePayees,
  financePostings,
  financeScheduledTransactions,
  financeTags,
  financeTransactionTags,
  financeTransactions,
  financeUnbalanced,
} from '../../db/schema'
import { NAME_MAX_LENGTH, NOTE_MAX_LENGTH } from '../../lib/edit'
import type { TransactionPatch } from '../../lib/edit'
import { NotFoundError, ValidationError } from '../errors'
import { getSystemAccounts } from './accounts'
import { resolvePayee } from './payees'
import { markV2Retired } from './settings'

export type NewPosting = {
  accountId: number
  // 最小貨幣單位的整數;正 = 借,負 = 貸
  amount: number
  currency: string
  memo?: string | null
}

export type NewTransaction = {
  // UTC 的 ISO 8601
  occurredAt: string
  payeeId?: number | null
  note?: string | null
  source: (typeof financeTransactions.$inferInsert)['source']
  externalId?: string | null
  // 匯入時的原始值;存成 JSON
  importMeta?: Record<string, unknown> | null
  categorySource?: (typeof financeTransactions.$inferInsert)['categorySource']
  // 配對到的週期項目
  scheduledId?: number | null
  postings: NewPosting[]
}

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|\+00:00)$/

// 格式對、而且日期真的存在。Date.parse 會把 2月30日 進位成 3月2日,所以解析後再反查年月日與時刻
function isValidUtcTimestamp(text: string): boolean {
  if (!ISO_UTC.test(text)) return false
  const time = Date.parse(text)
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 19) === text.slice(0, 19)
}

// 加總不為零的幣別(純函式)
export function unbalancedCurrencies(postings: readonly NewPosting[]): string[] {
  const totals = new Map<string, number>()
  for (const posting of postings) {
    totals.set(posting.currency, (totals.get(posting.currency) ?? 0) + posting.amount)
  }
  return [...totals].filter(([, total]) => total !== 0).map(([currency]) => currency)
}

function validate(db: FinanceConn, input: NewTransaction): Record<string, string> {
  const fields: Record<string, string> = {}
  if (!isValidUtcTimestamp(input.occurredAt)) fields.occurredAt = 'invalid'
  if (input.postings.length < 2) fields.postings = 'too_few'

  const accountIds = [...new Set(input.postings.map((posting) => posting.accountId))]
  const accounts = new Map(
    (accountIds.length
      ? db
          .select({ id: financeAccounts.id, currency: financeAccounts.currency })
          .from(financeAccounts)
          .where(inArray(financeAccounts.id, accountIds))
          .all()
      : []
    ).map((account) => [account.id, account]),
  )
  input.postings.forEach((posting, index) => {
    const account = accounts.get(posting.accountId)
    if (!Number.isSafeInteger(posting.amount) || posting.amount === 0) {
      fields[`postings.${index}.amount`] = 'invalid'
    }
    if (!account) {
      fields[`postings.${index}.accountId`] = 'not_found'
    } else if (account.currency !== null && account.currency !== posting.currency) {
      fields[`postings.${index}.currency`] = 'account_currency_mismatch'
    }
  })
  const unbalanced = unbalancedCurrencies(input.postings)
  if (unbalanced.length) fields.postings = `unbalanced:${unbalanced.join(',')}`

  if (input.payeeId != null) {
    const payee = db
      .select({ id: financePayees.id })
      .from(financePayees)
      .where(eq(financePayees.id, input.payeeId))
      .all()
    if (!payee.length) fields.payeeId = 'not_found'
  }
  if (input.scheduledId != null) {
    const item = db
      .select({ id: financeScheduledTransactions.id })
      .from(financeScheduledTransactions)
      .where(eq(financeScheduledTransactions.id, input.scheduledId))
      .all()
    if (!item.length) fields.scheduledId = 'not_found'
  }
  if (input.externalId != null) {
    const existing = db
      .select({ id: financeTransactions.id })
      .from(financeTransactions)
      .where(eq(financeTransactions.externalId, input.externalId))
      .all()
    if (existing.length) fields.externalId = 'duplicate'
  }
  return fields
}

// 新增一筆交易,回傳 id。不合法時丟 ValidationError,資料庫不變
export function createTransaction(
  db: FinanceConn,
  input: NewTransaction,
  now: string = new Date().toISOString(),
): number {
  return db.transaction((tx) => {
    const fields = validate(tx, input)
    if (Object.keys(fields).length) throw new ValidationError(fields)

    const [{ id }] = tx
      .insert(financeTransactions)
      .values({
        occurredAt: input.occurredAt,
        payeeId: input.payeeId ?? null,
        note: input.note ?? null,
        source: input.source,
        externalId: input.externalId ?? null,
        importMeta: input.importMeta ? JSON.stringify(input.importMeta) : null,
        categorySource: input.categorySource ?? null,
        scheduledId: input.scheduledId ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: financeTransactions.id })
      .all()
    tx.insert(financePostings)
      .values(
        input.postings.map((posting, index) => ({
          transactionId: id,
          accountId: posting.accountId,
          amount: posting.amount,
          currency: posting.currency,
          memo: posting.memo ?? null,
          sortOrder: index,
        })),
      )
      .run()

    // 提交前再用資料庫裡實際寫進去的分錄檢查一次
    const residual = tx
      .select()
      .from(financeUnbalanced)
      .where(eq(financeUnbalanced.transactionId, id))
      .all()
    if (residual.length) {
      throw new ValidationError({
        postings: `unbalanced:${residual.map((row) => row.currency).join(',')}`,
      })
    }
    return id
  })
}

// 只改交易的對象;分錄、分類、標籤不動
export function setTransactionPayee(
  db: FinanceConn,
  transactionId: number,
  payeeId: number | null,
  now: string = new Date().toISOString(),
): void {
  db.transaction((tx) => {
    if (payeeId !== null) {
      const payee = tx
        .select({ id: financePayees.id })
        .from(financePayees)
        .where(eq(financePayees.id, payeeId))
        .all()
      if (!payee.length) throw new ValidationError({ payeeId: 'not_found' })
    }
    const updated = tx
      .update(financeTransactions)
      .set({ payeeId, updatedAt: now })
      .where(eq(financeTransactions.id, transactionId))
      .returning({ id: financeTransactions.id })
      .all()
    if (!updated.length) throw new NotFoundError('Transaction', transactionId)
  })
}

// 存進資料庫的時間格式:UTC、精確到秒、結尾 +00:00
export function toStoredTimestamp(iso: string): string {
  return new Date(iso).toISOString().slice(0, 19) + '+00:00'
}

// 單筆編輯:分類、對象、日期時間、備註、標籤。金額與分錄的結構不動(那是結構性編輯)。
// patch 裡沒有的欄位不變。全部在同一個 DB transaction;任何一項不合法就丟 ValidationError,資料庫不變。
// 第一次編輯時一起寫入「v2 已停用」(見 settings.ts)
export function updateTransaction(
  db: FinanceConn,
  transactionId: number,
  patch: TransactionPatch,
  now: string = new Date().toISOString(),
): void {
  // updated_at 到毫秒:同一秒內連續編輯,也分得出版本(用來判斷資料是不是舊的)
  const version = new Date(now).toISOString().replace('Z', '+00:00')
  const stamp = toStoredTimestamp(now)
  db.transaction((tx) => {
    const [current] = tx
      .select({ updatedAt: financeTransactions.updatedAt, categorySource: financeTransactions.categorySource })
      .from(financeTransactions)
      .where(eq(financeTransactions.id, transactionId))
      .all()
    if (!current) throw new NotFoundError('Transaction', transactionId)
    if (current.updatedAt !== patch.expectedUpdatedAt) throw new ValidationError({ expectedUpdatedAt: 'stale' })

    const fields: Record<string, string> = {}
    const header: Partial<typeof financeTransactions.$inferInsert> = { updatedAt: version }

    if (patch.occurredAt !== undefined) {
      if (isValidUtcTimestamp(patch.occurredAt)) header.occurredAt = toStoredTimestamp(patch.occurredAt)
      else fields.occurredAt = 'invalid'
    }

    if (patch.note !== undefined) {
      const note = patch.note?.trim() ?? ''
      if (note.length > NOTE_MAX_LENGTH) fields.note = 'too_long'
      else header.note = note === '' ? null : note
    }

    if (patch.payee !== undefined) {
      if (patch.payee === null) header.payeeId = null
      else if ('id' in patch.payee) {
        const exists = tx.select({ id: financePayees.id }).from(financePayees).where(eq(financePayees.id, patch.payee.id)).all()
        if (exists.length) header.payeeId = patch.payee.id
        else fields.payee = 'not_found'
      } else {
        const name = patch.payee.name.trim()
        if (name === '') fields.payee = 'required'
        else if (name.length > NAME_MAX_LENGTH) fields.payee = 'too_long'
        // 對象名稱是使用者自己打的,不去掉付款處理商的後綴
        else header.payeeId = resolvePayee(tx, name, [], now)
      }
    }

    // 分類:每一條指定的分錄換到同類型的另一個分類。手續費是匯入時的結構,不能換進換出
    let categoriesChanged = false
    if (patch.categories !== undefined) {
      const system = getSystemAccounts(tx)
      const postings = new Map(
        tx
          .select({ id: financePostings.id, accountId: financePostings.accountId, type: financeAccounts.type })
          .from(financePostings)
          .innerJoin(financeAccounts, eq(financeAccounts.id, financePostings.accountId))
          .where(eq(financePostings.transactionId, transactionId))
          .all()
          .map((p) => [p.id, p]),
      )
      const targetIds = [...new Set(patch.categories.map((c) => c.accountId))]
      const targets = new Map(
        (targetIds.length
          ? tx
              .select({ id: financeAccounts.id, type: financeAccounts.type, isActive: financeAccounts.isActive })
              .from(financeAccounts)
              .where(inArray(financeAccounts.id, targetIds))
              .all()
          : []
        ).map((a) => [a.id, a]),
      )
      const seen = new Set<number>()
      patch.categories.forEach((change, index) => {
        const key = `categories.${index}`
        const posting = postings.get(change.postingId)
        const target = targets.get(change.accountId)
        if (seen.has(change.postingId)) fields[key] = 'duplicate'
        else if (!posting) fields[key] = 'posting_not_found'
        else if (posting.type !== 'expense' && posting.type !== 'income') fields[key] = 'not_a_category'
        else if (posting.accountId === system.fee) fields[key] = 'fee'
        else if (!target) fields[key] = 'account_not_found'
        else if (target.type !== posting.type) fields[key] = 'type_mismatch'
        else if (target.id === system.fee) fields[key] = 'fee'
        else if (!target.isActive && target.id !== posting.accountId) fields[key] = 'archived'
        seen.add(change.postingId)
        if (!fields[key] && posting && posting.accountId !== change.accountId) categoriesChanged = true
      })
    }

    let tagIds: number[] | null = null
    const newTagNames: string[] = []
    if (patch.tags !== undefined) {
      const ids = [...new Set(patch.tags.ids)]
      const found = ids.length
        ? tx.select({ id: financeTags.id }).from(financeTags).where(inArray(financeTags.id, ids)).all()
        : []
      if (found.length !== ids.length) fields.tags = 'not_found'
      for (const raw of patch.tags.newNames) {
        const name = raw.trim()
        if (name === '') fields.tags = 'name_required'
        else if (name.length > NAME_MAX_LENGTH) fields.tags = 'name_too_long'
        else if (!newTagNames.includes(name)) newTagNames.push(name)
      }
      tagIds = ids
    }

    if (Object.keys(fields).length) throw new ValidationError(fields)

    if (categoriesChanged && patch.categories) {
      for (const change of patch.categories) {
        tx.update(financePostings)
          .set({ accountId: change.accountId })
          .where(and(eq(financePostings.id, change.postingId), eq(financePostings.transactionId, transactionId)))
          .run()
      }
      // 分類全部回到未分類時,就不是任何人給的分類
      const system = getSystemAccounts(tx)
      const remaining = tx
        .select({ accountId: financePostings.accountId, type: financeAccounts.type })
        .from(financePostings)
        .innerJoin(financeAccounts, eq(financeAccounts.id, financePostings.accountId))
        .where(eq(financePostings.transactionId, transactionId))
        .all()
        .filter((p) => (p.type === 'expense' || p.type === 'income') && p.accountId !== system.fee)
      const allUncategorized = remaining.every(
        (p) => p.accountId === system.uncategorizedExpense || p.accountId === system.uncategorizedIncome,
      )
      header.categorySource = allUncategorized ? null : 'manual'
    }

    if (tagIds !== null) {
      for (const name of newTagNames) {
        const [existing] = tx.select({ id: financeTags.id }).from(financeTags).where(eq(financeTags.name, name)).all()
        const id =
          existing?.id ??
          tx.insert(financeTags).values({ name, createdAt: stamp }).returning({ id: financeTags.id }).all()[0].id
        if (!tagIds.includes(id)) tagIds.push(id)
      }
      tx.delete(financeTransactionTags).where(eq(financeTransactionTags.transactionId, transactionId)).run()
      if (tagIds.length) {
        tx.insert(financeTransactionTags).values(tagIds.map((tagId) => ({ transactionId, tagId }))).run()
      }
    }

    tx.update(financeTransactions).set(header).where(eq(financeTransactions.id, transactionId)).run()

    // 分錄的金額沒有動,這裡只是守住不變量
    const residual = tx.select().from(financeUnbalanced).where(eq(financeUnbalanced.transactionId, transactionId)).all()
    if (residual.length) throw new ValidationError({ postings: 'unbalanced' })

    markV2Retired(tx, stamp)
  })
}

