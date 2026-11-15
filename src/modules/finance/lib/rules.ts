// 規則管理與重新分類:API 回傳的形狀與請求的解析,前後端共用

export type RuleRow = {
  id: number
  matchField: 'payee' | 'source_category'
  payeeId: number | null
  payeeName: string | null
  matchValue: string | null
  assignAccountId: number | null
  assignAccountName: string | null
  priority: number
  isActive: boolean
}

export type RuleInput = {
  matchField: 'payee' | 'source_category'
  payeeId: number | null
  matchValue: string | null
  assignAccountId: number
  isActive: boolean
}

export type RuleUpdate = { payeeId?: number; matchValue?: string; assignAccountId?: number; isActive?: boolean }

// 重新分類的預覽:每一筆未分類的交易會被分到哪裡
export type ReclassifyItem = {
  transactionId: number
  occurredAt: string
  payee: string | null
  // 分類那一側的金額(未分類那條分錄,正數)
  amount: number
  currency: string
  accountId: number
  accountName: string
  categorySource: 'scheduled' | 'rule' | 'payee_history' | 'source_category'
}

export type ReclassifyPreview = {
  items: ReclassifyItem[]
  // 未分類、但規則和歷史都沒有命中的筆數
  unmatched: number
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isId = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0

type Parse<T> = { ok: true; value: T } | { ok: false; fields: Record<string, string> }

export function parseRuleInput(body: unknown): Parse<RuleInput> {
  if (!isObject(body)) return { ok: false, fields: { body: 'invalid' } }
  const fields: Record<string, string> = {}
  if (body.matchField !== 'payee' && body.matchField !== 'source_category') fields.matchField = 'invalid'
  const payeeId = body.payeeId === undefined || body.payeeId === null ? null : isId(body.payeeId) ? body.payeeId : undefined
  if (payeeId === undefined) fields.payeeId = 'invalid'
  const matchValue =
    body.matchValue === undefined || body.matchValue === null ? null : typeof body.matchValue === 'string' ? body.matchValue : undefined
  if (matchValue === undefined) fields.matchValue = 'invalid'
  if (!isId(body.assignAccountId)) fields.assignAccountId = 'required'
  const isActive = body.isActive === undefined ? true : body.isActive
  if (typeof isActive !== 'boolean') fields.isActive = 'invalid'
  if (Object.keys(fields).length) return { ok: false, fields }
  return {
    ok: true,
    value: {
      matchField: body.matchField as RuleInput['matchField'],
      payeeId: payeeId!,
      matchValue: matchValue!,
      assignAccountId: body.assignAccountId as number,
      isActive: isActive as boolean,
    },
  }
}

export function parseRuleUpdate(body: unknown): Parse<RuleUpdate> {
  if (!isObject(body)) return { ok: false, fields: { body: 'invalid' } }
  const fields: Record<string, string> = {}
  const value: RuleUpdate = {}
  for (const key of Object.keys(body)) {
    if (!['payeeId', 'matchValue', 'assignAccountId', 'isActive'].includes(key)) fields[key] = 'unknown'
  }
  if ('payeeId' in body) {
    if (isId(body.payeeId)) value.payeeId = body.payeeId
    else fields.payeeId = 'invalid'
  }
  if ('matchValue' in body) {
    if (typeof body.matchValue === 'string') value.matchValue = body.matchValue
    else fields.matchValue = 'invalid'
  }
  if ('assignAccountId' in body) {
    if (isId(body.assignAccountId)) value.assignAccountId = body.assignAccountId
    else fields.assignAccountId = 'invalid'
  }
  if ('isActive' in body) {
    if (typeof body.isActive === 'boolean') value.isActive = body.isActive
    else fields.isActive = 'invalid'
  }
  return Object.keys(fields).length ? { ok: false, fields } : { ok: true, value }
}
