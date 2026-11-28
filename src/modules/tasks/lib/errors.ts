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
const DISPLAY_FIELDS = [
  'title',
  'notes',
  'dueDate',
  'priority',
  'name',
  'target',
  'times',
  'date',
  'reminders',
  'daysBefore',
  'kind',
  'time',
] as const

const GENERAL_CODES: readonly string[] = ['NOT_FOUND', 'INTERNAL_ERROR', 'VALIDATION_FAILED']

const FIELD_MESSAGES: Record<string, string> = {
  'title.required': '標題不能空白',
  'dueDate.invalid_format': '日期格式不正確,要像 2026-09-18',
  'priority.invalid_value': '優先級只能是無、低、中、高',
  'name.required': '名稱不能空白',
  'target.invalid_value': '目標次數要是 1 以上的整數;留空代表只記錄次數',
  'times.out_of_order': '順序不對,必須是早上 < 下午 < 晚上',
  'date.invalid_format': '日期格式不正確,要像 2026-09-18',
  'date.in_past': '提醒時間已經過了,請選未來的時間',
  'reminders.too_many': '最多只能設 5 則提醒',
  'daysBefore.invalid_value': '提前天數不正確',
  'kind.invalid_value': '提醒類型不正確',
  'time.invalid_value': '時刻格式不正確,要像 09:00',
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

// 讀取重複規則時的泛用錯誤。404 是「規則」不見了,不是任務;其餘代碼和任務共用
export function recurrenceRuleMessage(code: GeneralCode): string {
  return code === 'NOT_FOUND' ? '找不到這個重複規則' : generalMessage(code)
}

// 習慣的一般寫入(新增、改欄位、停止、刪除)的泛用錯誤。404 是「習慣」不見了
export function habitMessage(code: GeneralCode): string {
  return code === 'NOT_FOUND' ? '找不到這個習慣,可能已經被刪除了' : generalMessage(code)
}

// 提醒與通知設定的泛用錯誤。404 是提醒或所屬項目不見了
export function reminderMessage(code: GeneralCode): string {
  return code === 'NOT_FOUND' ? '找不到這則提醒,可能已經被刪除了' : generalMessage(code)
}

// 垃圾桶寫入(還原、永久刪除)的泛用錯誤。404 代表任務可能已被還原或永久刪除
export function trashMessage(code: GeneralCode): string {
  return code === 'NOT_FOUND' ? '找不到這個任務,可能已被還原或永久刪除' : generalMessage(code)
}

// 習慣計數失敗:畫面已經從樂觀值還原成伺服器上的次數,訊息要講明,不能靜靜還原。
// 400 多半是習慣剛被停止(停止中不能記錄)或畫面不是最新的
export function habitCountMessage(code: GeneralCode): string {
  const reason =
    code === 'VALIDATION_FAILED'
      ? '這次記錄沒有存進去(習慣可能已停止)'
      : code === 'NOT_FOUND'
        ? '這次記錄沒有存進去(習慣可能已被刪除)'
        : `這次記錄沒有存進去:${generalMessage(code)}`
  return `${reason},次數已還原成伺服器上的值`
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
