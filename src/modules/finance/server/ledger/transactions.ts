// 交易的寫入。帳本裡寫入交易與分錄的地方只有這個檔;匯入、手動記帳、編輯都呼叫這裡。
//
// 不變量:表頭與分錄在同一個 DB transaction 裡寫入;提交前每個幣別的分錄加總為零。
import { eq, inArray } from 'drizzle-orm'
import type { FinanceConn } from '../../db/index'
import {
  financeAccounts,
  financePayees,
  financePostings,
  financeScheduledTransactions,
  financeTransactions,
  financeUnbalanced,
} from '../../db/schema'
import { NotFoundError, ValidationError } from '../errors'

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
