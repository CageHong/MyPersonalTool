// 交易清單的查詢(唯讀):篩選、排序、keyset 分頁、組出每一列要顯示的內容。
// 篩選規則只在這裡定義;清單畫面、之後的報表、匯出、批量編輯都經過這個函式,不各自寫一份。
// 語意(類型推導、交易金額、折合金額)見 docs/finance/transactions.md
import { inArray, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { FinanceDb } from '../../db/index'
import { financeTags, financeTransactionTags } from '../../db/schema'
import type {
  AccountType,
  PostingView,
  TransactionFilter,
  TransactionKind,
  TransactionLeg,
  TransactionPage,
  TransactionRow,
} from '../../lib/transactions'
import { NotFoundError, ValidationError } from '../errors'
import { FxRateMissingError, convert } from '../fx/index'
import { getSystemAccounts } from './accounts'
import type { SystemAccounts } from './accounts'
import { getCurrencyExponents, getDisplayCurrency } from './lookups'

export const DEFAULT_PAGE_SIZE = 100
export const MAX_PAGE_SIZE = 200

// ── cursor:上一頁最後一筆的 (occurred_at, id),編成不透明字串 ────────

type Cursor = { occurredAt: string; id: number }

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify([cursor.occurredAt, cursor.id])).toString('base64url')
}

function decodeCursor(raw: string): Cursor {
  try {
    const value: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      typeof value[0] === 'string' &&
      Number.isInteger(value[1])
    ) {
      return { occurredAt: value[0], id: value[1] as number }
    }
  } catch {
    // 落到下面的錯誤
  }
  throw new ValidationError({ cursor: 'invalid' })
}

// LIKE 的萬用字元當成一般字元
function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

// ── 查詢 ─────────────────────────────────────────────────────────

type HeaderRow = {
  id: number
  occurredAt: string
  note: string | null
  source: string
  categorySource: string | null
  updatedAt: string
  payeeId: number | null
  payeeName: string | null
  kind: TransactionKind
}

type PostingRow = {
  id: number
  transactionId: number
  accountId: number
  accountName: string
  accountType: AccountType
  parentName: string | null
  amount: number
  currency: string
  memo: string | null
}

// 類型的 SQL 運算式(用在 FROM finance_transactions t 的查詢裡)
function kindSql(system: SystemAccounts): SQL {
  // 類型:依序判斷,先符合的優先。手續費不決定類型(換匯、支出、轉帳都可能帶手續費):
  // 只有手續費、沒有其他分類時,動到兩個以上的資產 / 負債帳戶是轉帳,否則是支出
  const has = (condition: SQL) =>
    sql`EXISTS (SELECT 1 FROM finance_postings kp JOIN finance_accounts ka ON ka.id = kp.account_id
                WHERE kp.transaction_id = t.id AND ${condition})`
  const expenseOther = has(sql`ka.type = 'expense' AND ka.id <> ${system.fee}`)
  const income = has(sql`ka.type = 'income'`)
  const balanceAccounts = sql`(SELECT COUNT(DISTINCT kp.account_id) FROM finance_postings kp
                               JOIN finance_accounts ka ON ka.id = kp.account_id
                               WHERE kp.transaction_id = t.id AND ka.type IN ('asset', 'liability'))`
  return sql`CASE
      WHEN ${has(sql`ka.id = ${system.exchange}`)} THEN 'exchange'
      WHEN ${has(sql`ka.type = 'equity'`)} THEN 'opening'
      WHEN ${expenseOther} AND ${income} THEN 'mixed'
      WHEN ${expenseOther} THEN 'expense'
      WHEN ${income} THEN 'income'
      WHEN ${has(sql`ka.id = ${system.fee}`)} AND ${balanceAccounts} < 2 THEN 'expense'
      ELSE 'transfer' END`
}

export function listTransactions(
  db: FinanceDb,
  filter: TransactionFilter,
  page: { cursor?: string; limit?: number } = {},
): TransactionPage {
  const limit = page.limit ?? DEFAULT_PAGE_SIZE
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    throw new ValidationError({ limit: 'invalid' })
  }
  const cursor = page.cursor === undefined ? undefined : decodeCursor(page.cursor)
  const system = getSystemAccounts(db)

  const kindExpr = kindSql(system)

  const conditions: SQL[] = []
  const posting = (condition: SQL) =>
    sql`EXISTS (SELECT 1 FROM finance_postings fp WHERE fp.transaction_id = t.id AND ${condition})`
  if (filter.from) conditions.push(sql`substr(t.occurred_at, 1, 10) >= ${filter.from}`)
  if (filter.to) conditions.push(sql`substr(t.occurred_at, 1, 10) <= ${filter.to}`)
  if (filter.accountId) conditions.push(posting(sql`fp.account_id = ${filter.accountId}`))
  if (filter.categoryId) {
    conditions.push(
      posting(sql`fp.account_id IN (SELECT id FROM finance_accounts
                                    WHERE id = ${filter.categoryId} OR parent_id = ${filter.categoryId})`),
    )
  }
  if (filter.tagId) {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM finance_transaction_tags tt WHERE tt.transaction_id = t.id AND tt.tag_id = ${filter.tagId})`,
    )
  }
  if (filter.payeeId) conditions.push(sql`t.payee_id = ${filter.payeeId}`)
  if (filter.uncategorized) {
    conditions.push(
      posting(sql`fp.account_id IN (${system.uncategorizedExpense}, ${system.uncategorizedIncome})`),
    )
  }
  if (filter.q) {
    const pattern = likePattern(filter.q)
    conditions.push(sql`(
      py.name LIKE ${pattern} ESCAPE '\\'
      OR t.note LIKE ${pattern} ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM finance_payee_aliases al WHERE al.payee_id = t.payee_id AND al.alias LIKE ${pattern} ESCAPE '\\')
      OR ${posting(sql`fp.memo LIKE ${pattern} ESCAPE '\\'`)})`)
  }
  if (filter.kind) conditions.push(sql`(${kindExpr}) = ${filter.kind}`)

  const desc = filter.order === 'desc'
  if (cursor) {
    conditions.push(
      desc
        ? sql`(t.occurred_at < ${cursor.occurredAt} OR (t.occurred_at = ${cursor.occurredAt} AND t.id < ${cursor.id}))`
        : sql`(t.occurred_at > ${cursor.occurredAt} OR (t.occurred_at = ${cursor.occurredAt} AND t.id > ${cursor.id}))`,
    )
  }

  const where = conditions.length ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``
  const orderBy = desc ? sql`ORDER BY t.occurred_at DESC, t.id DESC` : sql`ORDER BY t.occurred_at ASC, t.id ASC`
  // 多取一筆,用來判斷有沒有下一頁
  const headers = db.all<HeaderRow>(sql`
    ${headerSelect(kindExpr)}
    ${where} ${orderBy} LIMIT ${limit + 1}`)

  const hasMore = headers.length > limit
  const pageRows = hasMore ? headers.slice(0, limit) : headers
  const last = pageRows.at(-1)
  return {
    items: buildRows(db, pageRows),
    nextCursor: hasMore && last ? encodeCursor({ occurredAt: last.occurredAt, id: last.id }) : null,
  }
}

function headerSelect(kindExpr: SQL): SQL {
  return sql`
    SELECT t.id, t.occurred_at AS occurredAt, t.note, t.source, t.category_source AS categorySource,
           t.updated_at AS updatedAt, t.payee_id AS payeeId, py.name AS payeeName, ${kindExpr} AS kind
    FROM finance_transactions t
    LEFT JOIN finance_payees py ON py.id = t.payee_id`
}

// 單筆交易的列(編輯之後回傳給畫面);不存在時丟 NotFoundError
export function getTransactionRow(db: FinanceDb, id: number): TransactionRow {
  const headers = db.all<HeaderRow>(sql`${headerSelect(kindSql(getSystemAccounts(db)))} WHERE t.id = ${id}`)
  if (!headers.length) throw new NotFoundError('Transaction', id)
  return buildRows(db, headers)[0]
}

// 一頁的表頭 → 完整的列(分錄、標籤、帳戶側、折合金額)
function buildRows(db: FinanceDb, headers: HeaderRow[]): TransactionRow[] {
  if (!headers.length) return []
  const ids = headers.map((h) => h.id)
  const idList = sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )
  const postings = db.all<PostingRow>(sql`
    SELECT p.id, p.transaction_id AS transactionId, p.account_id AS accountId, a.name AS accountName,
           a.type AS accountType, parent.name AS parentName, p.amount, p.currency, p.memo
    FROM finance_postings p
    JOIN finance_accounts a ON a.id = p.account_id
    LEFT JOIN finance_accounts parent ON parent.id = a.parent_id
    WHERE p.transaction_id IN (${idList})
    ORDER BY p.transaction_id, p.sort_order, p.id`)
  const tags = db
    .select({ transactionId: financeTransactionTags.transactionId, id: financeTags.id, name: financeTags.name })
    .from(financeTransactionTags)
    .innerJoin(financeTags, sql`${financeTags.id} = ${financeTransactionTags.tagId}`)
    .where(inArray(financeTransactionTags.transactionId, ids))
    .orderBy(financeTags.name)
    .all()

  const exponents = getCurrencyExponents(db)
  const display = getDisplayCurrency(db)

  return headers.map((header) => {
    const own = postings.filter((p) => p.transactionId === header.id)
    const categories: TransactionRow['categories'] = []
    const legs: TransactionLeg[] = []
    for (const p of own) {
      if (p.accountType === 'expense' || p.accountType === 'income') {
        if (!categories.some((c) => c.id === p.accountId)) {
          categories.push({ id: p.accountId, name: p.accountName, parentName: p.parentName })
        }
      } else if (p.accountType === 'asset' || p.accountType === 'liability') {
        const leg = legs.find((l) => l.accountId === p.accountId)
        if (leg) leg.amount += p.amount
        else legs.push({ accountId: p.accountId, accountName: p.accountName, currency: p.currency, amount: p.amount })
      }
    }
    const postingViews: PostingView[] = own.map((p) => ({
      id: p.id,
      accountId: p.accountId,
      accountName: p.accountName,
      accountType: p.accountType,
      amount: p.amount,
      currency: p.currency,
      memo: p.memo,
    }))
    return {
      id: header.id,
      occurredAt: header.occurredAt,
      kind: header.kind,
      payee: header.payeeId !== null && header.payeeName !== null ? { id: header.payeeId, name: header.payeeName } : null,
      note: header.note,
      source: header.source,
      categorySource: header.categorySource,
      updatedAt: header.updatedAt,
      categories,
      legs: legs.filter((l) => l.amount !== 0),
      displayAmount: displayAmountOf(db, header, own, exponents, display),
      tags: tags.filter((t) => t.transactionId === header.id).map(({ id, name }) => ({ id, name })),
      postings: postingViews,
    }
  })
}

// 折合金額:分類側分錄加總後取負號(支出為負、收入與退款為正),換成顯示幣別。
// 只有支出、收入、支出與收入有;轉帳、換匯、期初餘額沒有損益,回傳 null。
// 多種幣別先換算再加總,最後才取整數
function displayAmountOf(
  db: FinanceDb,
  header: HeaderRow,
  own: PostingRow[],
  exponents: Record<string, number>,
  display: string,
): number | null {
  if (header.kind !== 'expense' && header.kind !== 'income' && header.kind !== 'mixed') return null
  const date = header.occurredAt.slice(0, 10)
  const target = { currency: display, exponent: exponents[display] ?? 2 }
  let total = 0
  try {
    for (const p of own) {
      if (p.accountType !== 'expense' && p.accountType !== 'income') continue
      total += convert(db, -p.amount, { currency: p.currency, exponent: exponents[p.currency] ?? 2 }, target, date)
    }
  } catch (error) {
    if (error instanceof FxRateMissingError) return null
    throw error
  }
  return Math.round(total)
}
