// route handler 共用的協定層 helper:錯誤回應的形狀、錯誤類別 → 狀態碼、網址 id 與 body 的解析。
// 只處理 HTTP,不含業務邏輯;新增 route 時從這裡 import,不要在 route 檔內重寫。
// _lib 以底線開頭,Next 不會把它當成路由
import { NotFoundErrorBase, ValidationErrorBase } from '@/platform/errors'

export function errorResponse(
  status: number,
  code: string,
  message: string,
  fields?: Record<string, string>,
): Response {
  return Response.json({ error: { code, message, ...(fields && { fields }) } }, { status })
}

// 各工具 server/ 丟出的錯誤(繼承 src/platform/errors.ts 的基底)對映到狀態碼;404 的訊息依資源由呼叫端決定
export function handleError(label: string, error: unknown, notFoundMessage: string): Response {
  if (error instanceof ValidationErrorBase) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Validation failed', error.fields)
  }
  if (error instanceof NotFoundErrorBase) {
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
  reminderId: 'Invalid reminder id',
} as const

// 網址參數轉成 src/modules/tasks/server/ 函式簽章要求的 number;純解析,不是業務驗證。
// 不合法時直接回傳 400 的 Response,呼叫端用 instanceof Response 判斷後原樣回傳
export function parseId(raw: string, field: keyof typeof INVALID_ID_MESSAGES): number | Response {
  if (/^\d+$/.test(raw)) {
    return Number(raw)
  }
  return errorResponse(400, 'VALIDATION_FAILED', INVALID_ID_MESSAGES[field], { [field]: 'invalid' })
}

// 合法 JSON 但不是物件("hello"、[1,2]、null)一樣不能餵給各工具 server/ 的函式
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

// multipart/form-data 裡名為 field 的檔案,讀成文字。body 不是 form、沒有檔案、或混進非檔案的值時回傳 null。
// 檔案不寫到磁碟,只在這次請求裡用
export async function readFormFiles(
  request: Request,
  field: string,
): Promise<{ files: { name: string; text: string }[]; form: FormData } | null> {
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return null
  }
  const entries = form.getAll(field)
  if (!entries.length || entries.some((entry) => typeof entry === 'string')) {
    return null
  }
  const files = await Promise.all(
    (entries as File[]).map(async (file) => ({ name: file.name, text: await file.text() })),
  )
  return { files, form }
}
