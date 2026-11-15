// 標籤管理:API 回傳的形狀與請求的解析,前後端共用

export type TagRow = {
  id: number
  name: string
  // 旅行標籤:人在外地的第一天與最後一天(YYYY-MM-DD);一般標籤是 null
  startsOn: string | null
  endsOn: string | null
  transactions: number
}

export type TagInput = { name: string; startsOn: string | null; endsOn: string | null }
export type TagUpdate = Partial<TagInput>

// 「把範圍內的交易加上這個標籤」的預覽:範圍內還沒有這個標籤的交易
export type TagRangeItem = { transactionId: number; occurredAt: string; payee: string | null; kind: string }

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isDateOrNull = (value: unknown) => value === null || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value))

type Parse<T> = { ok: true; value: T } | { ok: false; fields: Record<string, string> }

export function parseTagInput(body: unknown, partial: boolean): Parse<TagUpdate> {
  if (!isObject(body)) return { ok: false, fields: { body: 'invalid' } }
  const fields: Record<string, string> = {}
  const value: TagUpdate = {}
  for (const key of Object.keys(body)) if (!['name', 'startsOn', 'endsOn'].includes(key)) fields[key] = 'unknown'
  if ('name' in body) {
    if (typeof body.name === 'string') value.name = body.name
    else fields.name = 'invalid'
  } else if (!partial) fields.name = 'required'
  for (const key of ['startsOn', 'endsOn'] as const) {
    if (key in body) {
      if (isDateOrNull(body[key])) value[key] = body[key] as string | null
      else fields[key] = 'invalid'
    } else if (!partial) value[key] = null
  }
  return Object.keys(fields).length ? { ok: false, fields } : { ok: true, value }
}
