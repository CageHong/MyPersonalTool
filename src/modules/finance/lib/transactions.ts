// 交易清單:API 回傳的形狀,以及篩選條件 ↔ 網址參數。前後端共用:
// 畫面用它把篩選條件寫進網址,route handler 用同一個函式解析,參數名只在這裡定義。
// 金額一律是最小貨幣單位的整數(正 = 借、負 = 貸),顯示時用 exponents 換算(lib/money.ts)。
// 各欄位的語意(類型怎麼推導、交易金額與折合金額的定義)見 docs/finance/transactions.md

// 交易類型由分錄涉及的帳戶推導,不存在資料庫裡
export const TRANSACTION_KINDS = ['expense', 'income', 'transfer', 'exchange', 'opening', 'mixed'] as const
export type TransactionKind = (typeof TRANSACTION_KINDS)[number]

export const KIND_LABELS: Record<TransactionKind, string> = {
  expense: '支出',
  income: '收入',
  transfer: '轉帳',
  exchange: '換匯',
  opening: '期初餘額',
  mixed: '支出與收入',
}

export type TransactionOrder = 'desc' | 'asc'

export type TransactionFilter = {
  // YYYY-MM-DD,含當天;以 UTC 切日(跟 ledger 的餘額函式相同)
  from?: string
  to?: string
  // 資產或負債帳戶
  accountId?: number
  // 分類;選上層時包含子分類
  categoryId?: number
  tagId?: number
  payeeId?: number
  kind?: TransactionKind
  // 有分錄記在「未分類」或「未分類收入」
  uncategorized?: boolean
  // 收款人名稱、收款人別名、備註、分錄備註,部分相符、不分大小寫(只對英文字母)
  q?: string
  order: TransactionOrder
}

export const EMPTY_FILTER: TransactionFilter = { order: 'desc' }

export const SEARCH_MAX_LENGTH = 100

// 網址參數名
const P = {
  from: 'from',
  to: 'to',
  accountId: 'account',
  categoryId: 'category',
  tagId: 'tag',
  payeeId: 'payee',
  kind: 'kind',
  uncategorized: 'uncategorized',
  q: 'q',
  order: 'order',
} as const

export type FilterParseResult =
  | { ok: true; filter: TransactionFilter }
  | { ok: false; fields: Record<string, string> }

function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

// 網址參數 → 篩選條件。不認識的參數(例如分頁的 cursor、limit)不理會;
// 空字串視為沒有給
export function parseTransactionFilter(params: URLSearchParams): FilterParseResult {
  const fields: Record<string, string> = {}
  const filter: TransactionFilter = { order: 'desc' }
  const get = (name: string) => {
    const value = params.get(name)
    return value === null || value.trim() === '' ? undefined : value.trim()
  }

  for (const key of ['from', 'to'] as const) {
    const value = get(P[key])
    if (value === undefined) continue
    if (isDate(value)) filter[key] = value
    else fields[P[key]] = 'invalid'
  }
  if (filter.from && filter.to && filter.from > filter.to) fields[P.to] = 'before_from'

  for (const key of ['accountId', 'categoryId', 'tagId', 'payeeId'] as const) {
    const value = get(P[key])
    if (value === undefined) continue
    if (/^[1-9]\d*$/.test(value)) filter[key] = Number(value)
    else fields[P[key]] = 'invalid'
  }

  const kind = get(P.kind)
  if (kind !== undefined) {
    if ((TRANSACTION_KINDS as readonly string[]).includes(kind)) filter.kind = kind as TransactionKind
    else fields[P.kind] = 'invalid'
  }

  const uncategorized = get(P.uncategorized)
  if (uncategorized !== undefined) {
    if (uncategorized === '1') filter.uncategorized = true
    else fields[P.uncategorized] = 'invalid'
  }

  const q = get(P.q)
  if (q !== undefined) {
    if (q.length <= SEARCH_MAX_LENGTH) filter.q = q
    else fields[P.q] = 'too_long'
  }

  const order = get(P.order)
  if (order !== undefined) {
    if (order === 'asc' || order === 'desc') filter.order = order
    else fields[P.order] = 'invalid'
  }

  return Object.keys(fields).length ? { ok: false, fields } : { ok: true, filter }
}

// 篩選條件 → 網址參數。預設值(由新到舊)與沒有給的條件不寫出來,網址保持簡短
export function filterToSearchParams(filter: TransactionFilter): URLSearchParams {
  const params = new URLSearchParams()
  if (filter.from) params.set(P.from, filter.from)
  if (filter.to) params.set(P.to, filter.to)
  if (filter.accountId) params.set(P.accountId, String(filter.accountId))
  if (filter.categoryId) params.set(P.categoryId, String(filter.categoryId))
  if (filter.tagId) params.set(P.tagId, String(filter.tagId))
  if (filter.payeeId) params.set(P.payeeId, String(filter.payeeId))
  if (filter.kind) params.set(P.kind, filter.kind)
  if (filter.uncategorized) params.set(P.uncategorized, '1')
  if (filter.q) params.set(P.q, filter.q)
  if (filter.order !== 'desc') params.set(P.order, filter.order)
  return params
}

export function isFilterEmpty(filter: TransactionFilter): boolean {
  return filterToSearchParams({ ...filter, order: 'desc' }).size === 0
}

// ── API 回傳的形狀 ────────────────────────────────────────────────

export type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense'

export type PostingView = {
  id: number
  accountId: number
  accountName: string
  accountType: AccountType
  amount: number
  currency: string
  memo: string | null
}

// 帳戶側(資產、負債)的分錄,同一個帳戶合併成一筆
export type TransactionLeg = { accountId: number; accountName: string; currency: string; amount: number }

export type TransactionRow = {
  id: number
  occurredAt: string
  kind: TransactionKind
  payee: { id: number; name: string } | null
  note: string | null
  source: string
  categorySource: string | null
  // 分類側(支出、收入)的帳戶,依分錄順序、不重複;子分類帶上層名稱
  categories: { id: number; name: string; parentName: string | null }[]
  legs: TransactionLeg[]
  // 折合顯示幣別的最小貨幣單位(已取整數)。只有支出、收入、支出與收入有;
  // 缺匯率時是 null
  displayAmount: number | null
  tags: { id: number; name: string }[]
  postings: PostingView[]
}

export type TransactionPage = {
  items: TransactionRow[]
  // 下一頁的起點;null = 沒有下一頁
  nextCursor: string | null
}

// 篩選選單與顯示要用的選項
export type FinanceLookups = {
  displayCurrency: string
  // 幣別 → 小數位數
  exponents: Record<string, number>
  accounts: {
    id: number
    name: string
    type: AccountType
    subtype: string | null
    parentId: number | null
    currency: string | null
    isActive: boolean
  }[]
  tags: { id: number; name: string; startsOn: string | null; endsOn: string | null }[]
  payees: { id: number; name: string }[]
}
