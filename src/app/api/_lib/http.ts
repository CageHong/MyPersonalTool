// route handler 共用的協定層 helper:錯誤回應的形狀、錯誤類別 → 狀態碼、網址 id 與 body 的解析。
// 只處理 HTTP,不含業務邏輯;新增 route 時從這裡 import,不要在 route 檔內重寫。
// _lib 以底線開頭,Next 不會把它當成路由
import { NotFoundError, ValidationError } from '@/server/tasks'

export function errorResponse(
  status: number,
  code: string,
  message: string,
  fields?: Record<string, string>,
): Response {
  return Response.json({ error: { code, message, ...(fields && { fields }) } }, { status })
}

// src/server/ 丟出的錯誤類別對映到狀態碼;404 的訊息依資源由呼叫端決定
export function handleError(label: string, error: unknown, notFoundMessage: string): Response {
  if (error instanceof ValidationError) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Validation failed', error.fields)
  }
  if (error instanceof NotFoundError) {
    return errorResponse(404, 'NOT_FOUND', notFoundMessage)
  }
  console.error(label, error)
  return errorResponse(500, 'INTERNAL_ERROR', 'Internal server error')
}

// 欄位名跟著網址參數名;訊息依欄位固定,不讓各 route 自己拼
const INVALID_ID_MESSAGES = {
  id: 'Invalid task id',
  itemId: 'Invalid checklist item id',
  ruleId: 'Invalid recurrence rule id',
  habitId: 'Invalid habit id',
} as const

// 網址參數轉成 src/server/ 函式簽章要求的 number;純解析,不是業務驗證。
// 不合法時直接回傳 400 的 Response,呼叫端用 instanceof Response 判斷後原樣回傳
export function parseId(raw: string, field: keyof typeof INVALID_ID_MESSAGES): number | Response {
  if (/^\d+$/.test(raw)) {
    return Number(raw)
  }
  return errorResponse(400, 'VALIDATION_FAILED', INVALID_ID_MESSAGES[field], { [field]: 'invalid' })
}

// 合法 JSON 但不是物件("hello"、[1,2]、null)一樣不能餵給 src/server/ 的函式
export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return null
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return null
  }
  return body as Record<string, unknown>
}
