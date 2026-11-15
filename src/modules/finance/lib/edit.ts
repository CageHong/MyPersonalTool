// 單筆編輯(分類、對象、日期時間、備註、標籤):API 請求的形狀與協定層的解析,前後端共用。
// 這裡只檢查型別;業務規則(分類要同類型、對象存在、資料是不是舊的)在 server/ledger/transactions.ts。
// 語意見 docs/finance/transactions.md 的「編輯」

export const NOTE_MAX_LENGTH = 1000
export const NAME_MAX_LENGTH = 200

// 對象:選既有的、輸入名稱(比對別名,對不到才新增)、或清空
export type PayeeChange = { id: number } | { name: string } | null

// 把一條分類分錄換到另一個分類;金額不變
export type CategoryChange = { postingId: number; accountId: number }

// 整組替換時的一條分錄。amount 是最小貨幣單位的整數,正 = 借、負 = 貸
export type PostingInput = { accountId: number; amount: number; currency: string; memo: string | null }

export type TransactionPatch = {
  // 讀取時的 updatedAt;資料庫裡的不一樣(別處改過)就拒絕
  expectedUpdatedAt: string
  // UTC 的 ISO 8601
  occurredAt?: string
  // 空字串 = 清空
  note?: string | null
  payee?: PayeeChange
  categories?: CategoryChange[]
  // 整組替換分錄(拆帳、改成轉帳、收回等);不能跟 categories 同時給
  postings?: PostingInput[]
  // 改完之後的完整標籤:既有的 id + 要新增的名稱(同名的已經存在就用它)
  tags?: { ids: number[]; newNames: string[] }
}

export type PatchParse = { ok: true; patch: TransactionPatch } | { ok: false; fields: Record<string, string> }

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isId = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0

const KNOWN_KEYS = new Set(['expectedUpdatedAt', 'occurredAt', 'note', 'payee', 'categories', 'postings', 'tags'])

// 分錄的陣列;形狀不對時是 null
function parsePostings(list: unknown): PostingInput[] | null {
  const valid =
    Array.isArray(list) &&
    list.every(
      (p) =>
        isObject(p) &&
        isId(p.accountId) &&
        Number.isSafeInteger(p.amount) &&
        typeof p.currency === 'string' &&
        (p.memo === undefined || p.memo === null || typeof p.memo === 'string'),
    )
  if (!valid) return null
  return (list as Record<string, unknown>[]).map((p) => ({
    accountId: p.accountId as number,
    amount: p.amount as number,
    currency: p.currency as string,
    memo: (p.memo as string | null | undefined) ?? null,
  }))
}

function parsePayee(payee: unknown): PayeeChange | undefined {
  if (payee === null) return null
  if (isObject(payee) && isId(payee.id) && Object.keys(payee).length === 1) return { id: payee.id }
  if (isObject(payee) && typeof payee.name === 'string' && Object.keys(payee).length === 1) return { name: payee.name }
  return undefined
}

// 請求的 JSON → TransactionPatch。只看型別與形狀
export function parseTransactionPatch(body: unknown): PatchParse {
  if (!isObject(body)) return { ok: false, fields: { body: 'invalid' } }
  const fields: Record<string, string> = {}
  for (const key of Object.keys(body)) if (!KNOWN_KEYS.has(key)) fields[key] = 'unknown'

  const patch: TransactionPatch = { expectedUpdatedAt: '' }
  if (typeof body.expectedUpdatedAt === 'string' && body.expectedUpdatedAt) {
    patch.expectedUpdatedAt = body.expectedUpdatedAt
  } else fields.expectedUpdatedAt = 'required'

  if ('occurredAt' in body) {
    if (typeof body.occurredAt === 'string') patch.occurredAt = body.occurredAt
    else fields.occurredAt = 'invalid'
  }
  if ('note' in body) {
    if (body.note === null || typeof body.note === 'string') patch.note = body.note
    else fields.note = 'invalid'
  }
  if ('payee' in body) {
    const payee = parsePayee(body.payee)
    if (payee === undefined) fields.payee = 'invalid'
    else patch.payee = payee
  }
  if ('categories' in body) {
    const list = body.categories
    if (Array.isArray(list) && list.every((c) => isObject(c) && isId(c.postingId) && isId(c.accountId))) {
      patch.categories = list.map((c) => ({ postingId: c.postingId as number, accountId: c.accountId as number }))
    } else fields.categories = 'invalid'
  }
  if ('postings' in body) {
    const postings = parsePostings(body.postings)
    if (postings) patch.postings = postings
    else fields.postings = 'invalid'
    if ('categories' in body) fields.categories = 'with_postings'
  }
  if ('tags' in body) {
    const tags = body.tags
    if (
      isObject(tags) &&
      Array.isArray(tags.ids) &&
      tags.ids.every(isId) &&
      Array.isArray(tags.newNames) &&
      tags.newNames.every((name) => typeof name === 'string')
    ) {
      patch.tags = { ids: tags.ids as number[], newNames: tags.newNames as string[] }
    } else fields.tags = 'invalid'
  }
  return Object.keys(fields).length ? { ok: false, fields } : { ok: true, patch }
}

// ── 新增交易(手動記帳) ──────────────────────────────────────────

export type NewTransactionInput = {
  // UTC 的 ISO 8601
  occurredAt: string
  payee: PayeeChange
  note: string | null
  postings: PostingInput[]
}

export type NewTransactionParse = { ok: true; input: NewTransactionInput } | { ok: false; fields: Record<string, string> }

const NEW_KEYS = new Set(['occurredAt', 'payee', 'note', 'postings'])

// 請求的 JSON → NewTransactionInput。只看型別與形狀;payee、note 可以省略(= 沒有)
export function parseNewTransaction(body: unknown): NewTransactionParse {
  if (!isObject(body)) return { ok: false, fields: { body: 'invalid' } }
  const fields: Record<string, string> = {}
  for (const key of Object.keys(body)) if (!NEW_KEYS.has(key)) fields[key] = 'unknown'
  const occurredAt = typeof body.occurredAt === 'string' ? body.occurredAt : null
  if (occurredAt === null) fields.occurredAt = 'required'
  const payee = 'payee' in body ? parsePayee(body.payee) : null
  if (payee === undefined) fields.payee = 'invalid'
  const note = body.note === undefined || body.note === null ? null : typeof body.note === 'string' ? body.note : undefined
  if (note === undefined) fields.note = 'invalid'
  const postings = parsePostings(body.postings)
  if (postings === null) fields.postings = 'invalid'
  if (Object.keys(fields).length) return { ok: false, fields }
  return { ok: true, input: { occurredAt: occurredAt!, payee: payee!, note: note!, postings: postings! } }
}

