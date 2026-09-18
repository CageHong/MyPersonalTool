// API 錯誤的前端表示法與中文訊息。
// 分兩種:欄位錯誤(畫面上有欄位可以標示)與泛用錯誤(只能整段顯示)。
// 錯誤代碼一律在這裡轉成中文,元件不碰原始代碼,也不顯示 API 的英文訊息。

// 欄位名 → 錯誤代碼,例如 { title: 'required' }
export type FieldErrors = Record<string, string>

export type GeneralCode =
  // 來自 API 的 error.code
  | 'NOT_FOUND'
  | 'INTERNAL_ERROR'
  | 'VALIDATION_FAILED'
  // fetch 本身失敗:網路中斷、伺服器沒起來
  | 'NETWORK'
  // 回應不是預期的形狀
  | 'BAD_RESPONSE'

export type ApiError = { kind: 'fields'; fields: FieldErrors } | { kind: 'general'; code: GeneralCode }

export const NETWORK_ERROR: ApiError = { kind: 'general', code: 'NETWORK' }

// 畫面上真的有欄位可以標示的 key。API 的 fields 還會出現 id、body 這種協定層的 key,
// 它們沒有對應的輸入框,歸類成泛用錯誤
const DISPLAY_FIELDS = ['title', 'notes', 'dueDate', 'priority'] as const

const GENERAL_CODES: readonly string[] = ['NOT_FOUND', 'INTERNAL_ERROR', 'VALIDATION_FAILED']

const FIELD_MESSAGES: Record<string, string> = {
  'title.required': '標題不能空白',
  'dueDate.invalid_format': '日期格式不正確,要像 2026-09-18',
  'priority.invalid_value': '優先級只能是無、低、中、高',
}

const GENERAL_MESSAGES: Record<GeneralCode, string> = {
  NOT_FOUND: '找不到這個任務,可能已經被刪除了',
  INTERNAL_ERROR: '伺服器發生錯誤,請稍後再試',
  VALIDATION_FAILED: '送出的內容不合法',
  NETWORK: '連線失敗,請檢查網路後再試一次',
  BAD_RESPONSE: '伺服器回應看不懂,請稍後再試',
}

// 對應不到的代碼給中文 fallback,不要把原始代碼漏到畫面上
export function fieldMessage(field: string, code: string): string {
  return FIELD_MESSAGES[`${field}.${code}`] ?? '這個欄位的值不正確'
}

export function generalMessage(code: GeneralCode): string {
  return GENERAL_MESSAGES[code] ?? '操作失敗,請再試一次'
}

// 修改或刪除 checklist 項目時的泛用錯誤。API 的 404 不分資源,
// 由前端依動作決定是「項目」不見了;其餘代碼和任務共用同一套訊息
export function checklistItemMessage(code: GeneralCode): string {
  return code === 'NOT_FOUND' ? '找不到這個項目,可能已被刪除' : generalMessage(code)
}

function toGeneralCode(code: unknown): GeneralCode {
  return typeof code === 'string' && GENERAL_CODES.includes(code)
    ? (code as GeneralCode)
    : 'BAD_RESPONSE'
}

// 回應不 ok 時呼叫。fields 裡有畫面上的欄位就是欄位錯誤,其餘一律泛用
export async function readApiError(response: Response): Promise<ApiError> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    return { kind: 'general', code: 'BAD_RESPONSE' }
  }

  const error = (body as { error?: { code?: unknown; fields?: Record<string, unknown> } })?.error
  if (!error) {
    return { kind: 'general', code: 'BAD_RESPONSE' }
  }

  if (error.fields) {
    const fields: FieldErrors = {}
    for (const field of DISPLAY_FIELDS) {
      const code = error.fields[field]
      if (typeof code === 'string') {
        fields[field] = code
      }
    }
    if (Object.keys(fields).length > 0) {
      return { kind: 'fields', fields }
    }
  }

  return { kind: 'general', code: toGeneralCode(error.code) }
}
