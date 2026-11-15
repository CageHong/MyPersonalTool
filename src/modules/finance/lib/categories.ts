// 分類管理:API 回傳的形狀與請求的協定層解析,前後端共用

export type CategoryNode = {
  id: number
  name: string
  type: 'expense' | 'income'
  parentId: number | null
  sortOrder: number
  isActive: boolean
  isSystem: boolean
  // 有分錄在這個分類的交易筆數
  transactions: number
  // 指到這個分類的規則、週期項目數量
  rules: number
  scheduled: number
}

export type CategoryCreate = { name: string; type: 'expense' | 'income'; parentId: number | null }
export type CategoryUpdate = { name?: string; parentId?: number | null; isActive?: boolean }

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isId = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0

type Parse<T> = { ok: true; value: T } | { ok: false; fields: Record<string, string> }

export function parseCategoryCreate(body: unknown): Parse<CategoryCreate> {
  if (!isObject(body)) return { ok: false, fields: { body: 'invalid' } }
  const fields: Record<string, string> = {}
  if (typeof body.name !== 'string') fields.name = 'required'
  if (body.type !== 'expense' && body.type !== 'income') fields.type = 'invalid'
  const parentId = body.parentId === undefined || body.parentId === null ? null : isId(body.parentId) ? body.parentId : undefined
  if (parentId === undefined) fields.parentId = 'invalid'
  if (Object.keys(fields).length) return { ok: false, fields }
  return { ok: true, value: { name: body.name as string, type: body.type as 'expense' | 'income', parentId: parentId! } }
}

export function parseCategoryUpdate(body: unknown): Parse<CategoryUpdate> {
  if (!isObject(body)) return { ok: false, fields: { body: 'invalid' } }
  const fields: Record<string, string> = {}
  const value: CategoryUpdate = {}
  for (const key of Object.keys(body)) if (!['name', 'parentId', 'isActive'].includes(key)) fields[key] = 'unknown'
  if ('name' in body) {
    if (typeof body.name === 'string') value.name = body.name
    else fields.name = 'invalid'
  }
  if ('parentId' in body) {
    if (body.parentId === null || isId(body.parentId)) value.parentId = body.parentId as number | null
    else fields.parentId = 'invalid'
  }
  if ('isActive' in body) {
    if (typeof body.isActive === 'boolean') value.isActive = body.isActive
    else fields.isActive = 'invalid'
  }
  return Object.keys(fields).length ? { ok: false, fields } : { ok: true, value }
}
