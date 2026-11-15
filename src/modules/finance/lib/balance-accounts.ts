// 資產 / 負債帳戶(錢實際存放的地方)的管理:API 回傳的形狀與請求的解析,前後端共用

export const SUBTYPES = {
  asset: [
    { key: 'bank', label: '銀行' },
    { key: 'cash', label: '現金 / 電子錢包' },
    { key: 'broker', label: '證券' },
    { key: 'receivable', label: '代墊款(別人欠我的)' },
    { key: 'deposit', label: '保證金' },
    { key: 'prepaid', label: '預付' },
  ],
  liability: [
    { key: 'credit_card', label: '信用卡' },
    { key: 'loan', label: '貸款' },
  ],
} as const

export type BalanceAccountType = keyof typeof SUBTYPES

export type BalanceAccountRow = {
  id: number
  name: string
  type: BalanceAccountType
  subtype: string | null
  currency: string
  isActive: boolean
  // 最小貨幣單位;asset 正 = 有錢,liability 負 = 欠款
  balance: number
  transactions: number
}

export type BalanceAccountInput = { name: string; type: BalanceAccountType; subtype: string; currency: string }
export type BalanceAccountUpdate = { name?: string; subtype?: string; isActive?: boolean }

// 刪掉過的匯入交易(finance_deleted_external_ids),給匯入頁的清單
export type DeletedImportRow = {
  externalId: string
  source: string
  deletedAt: string
  // 刪除當時的內容摘要
  occurredAt: string | null
  payee: string | null
  amounts: { currency: string; amount: number }[]
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

type Parse<T> = { ok: true; value: T } | { ok: false; fields: Record<string, string> }

export function parseBalanceAccountInput(body: unknown): Parse<BalanceAccountInput> {
  if (!isObject(body)) return { ok: false, fields: { body: 'invalid' } }
  const fields: Record<string, string> = {}
  if (typeof body.name !== 'string') fields.name = 'required'
  if (body.type !== 'asset' && body.type !== 'liability') fields.type = 'invalid'
  if (typeof body.subtype !== 'string') fields.subtype = 'required'
  if (typeof body.currency !== 'string') fields.currency = 'required'
  if (Object.keys(fields).length) return { ok: false, fields }
  return {
    ok: true,
    value: {
      name: body.name as string,
      type: body.type as BalanceAccountType,
      subtype: body.subtype as string,
      currency: body.currency as string,
    },
  }
}

export function parseBalanceAccountUpdate(body: unknown): Parse<BalanceAccountUpdate> {
  if (!isObject(body)) return { ok: false, fields: { body: 'invalid' } }
  const fields: Record<string, string> = {}
  const value: BalanceAccountUpdate = {}
  for (const key of Object.keys(body)) if (!['name', 'subtype', 'isActive'].includes(key)) fields[key] = 'unknown'
  if ('name' in body) {
    if (typeof body.name === 'string') value.name = body.name
    else fields.name = 'invalid'
  }
  if ('subtype' in body) {
    if (typeof body.subtype === 'string') value.subtype = body.subtype
    else fields.subtype = 'invalid'
  }
  if ('isActive' in body) {
    if (typeof body.isActive === 'boolean') value.isActive = body.isActive
    else fields.isActive = 'invalid'
  }
  return Object.keys(fields).length ? { ok: false, fields } : { ok: true, value }
}
