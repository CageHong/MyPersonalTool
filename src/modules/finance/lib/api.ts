// 呼叫 /api/finance/* 的共用函式與錯誤訊息。錯誤一律在這裡轉成中文,元件不碰原始代碼。
// API 的錯誤形狀:{ error: { code, message, fields? } }(平台規則)

export class FinanceApiError extends Error {
  constructor(
    readonly code: string,
    readonly fields: Record<string, string> = {},
  ) {
    super(code)
    this.name = 'FinanceApiError'
  }
}

// POST multipart/form-data,回傳 JSON。失敗時 throw FinanceApiError(網路失敗的 code 是 NETWORK)
export async function postForm<T>(url: string, form: FormData): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, { method: 'POST', body: form })
  } catch {
    throw new FinanceApiError('NETWORK')
  }
  const body: unknown = await response.json().catch(() => null)
  if (response.ok && body !== null) return body as T
  const error = (body as { error?: { code?: string; fields?: Record<string, string> } } | null)?.error
  throw new FinanceApiError(error?.code ?? 'BAD_RESPONSE', error?.fields ?? {})
}

// GET,回傳 JSON。失敗時 throw FinanceApiError;signal 用來取消已經過時的請求(取消時 throw AbortError)
export async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, { signal })
  } catch (caught) {
    if (signal?.aborted) throw caught
    throw new FinanceApiError('NETWORK')
  }
  const body: unknown = await response.json().catch(() => null)
  if (response.ok && body !== null) return body as T
  const error = (body as { error?: { code?: string; fields?: Record<string, string> } } | null)?.error
  throw new FinanceApiError(error?.code ?? 'BAD_RESPONSE', error?.fields ?? {})
}

// PATCH JSON,回傳 JSON。失敗時 throw FinanceApiError
export function patchJson<T>(url: string, body: unknown): Promise<T> {
  return sendJson<T>('PATCH', url, body)
}

// POST JSON,回傳 JSON。失敗時 throw FinanceApiError
export function postJson<T>(url: string, body: unknown): Promise<T> {
  return sendJson<T>('POST', url, body)
}

// 成功時沒有內容(204)的請求;失敗時 throw FinanceApiError
export async function sendNoContent(method: 'PATCH' | 'POST' | 'DELETE', url: string, body?: unknown): Promise<void> {
  let response: Response
  try {
    response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new FinanceApiError('NETWORK')
  }
  if (response.ok) return
  const parsed: unknown = await response.json().catch(() => null)
  const error = (parsed as { error?: { code?: string; fields?: Record<string, string> } } | null)?.error
  throw new FinanceApiError(error?.code ?? 'BAD_RESPONSE', error?.fields ?? {})
}

async function sendJson<T>(method: 'PATCH' | 'POST', url: string, body: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new FinanceApiError('NETWORK')
  }
  const parsed: unknown = await response.json().catch(() => null)
  if (response.ok && parsed !== null) return parsed as T
  const error = (parsed as { error?: { code?: string; fields?: Record<string, string> } } | null)?.error
  throw new FinanceApiError(error?.code ?? 'BAD_RESPONSE', error?.fields ?? {})
}

// DELETE,成功時沒有內容。失敗時 throw FinanceApiError
export function deleteRequest(url: string): Promise<void> {
  return sendNoContent('DELETE', url)
}

// 讀取資料(交易清單、篩選選項)的錯誤 → 給人看的訊息
export function loadErrorMessage(error: unknown): string {
  if (!(error instanceof FinanceApiError)) return '發生未預期的錯誤'
  if (error.code === 'VALIDATION_FAILED') return '篩選條件不合法,請清除篩選後再試。'
  if (error.code === 'NETWORK') return '連不到伺服器。'
  return '伺服器發生錯誤,詳細內容在伺服器的紀錄裡。'
}

// 對帳單匯入的錯誤 → 給人看的訊息
export function importErrorMessage(error: unknown): string {
  if (!(error instanceof FinanceApiError)) return '發生未預期的錯誤'
  const { code, fields } = error
  if (code === 'VALIDATION_FAILED') {
    if (fields.fingerprint === 'stale') return '帳本在試跑之後有變動,要套用的內容跟報告不同。請重新試跑。'
    if (fields.plan === 'blocked') return '有無法處理的列,不能套用。'
    if (fields.plan === 'conflicts') return '檔案之間有內容不同的同一個 ID,不能套用。'
    if (fields.files === 'required') return '請先選擇對帳單檔案。'
    // 檔案本身的問題(認不出來源、缺欄位):伺服器給的說明已經帶檔名
    if (fields.files) return fields.files
    return '輸入不合法。'
  }
  if (code === 'NETWORK') return '連不到伺服器。'
  return '伺服器發生錯誤,詳細內容在伺服器的紀錄裡。'
}

// 單筆編輯的錯誤 → 給人看的訊息
export function editErrorMessage(error: unknown): string {
  if (!(error instanceof FinanceApiError)) return '發生未預期的錯誤'
  const { code, fields } = error
  if (code === 'VALIDATION_FAILED') {
    if (fields.expectedUpdatedAt === 'stale') return '這筆交易在打開之後被改過(別的分頁或匯入)。請關閉後重新打開再改。'
    if (fields.occurredAt) return '日期時間不合法。'
    if (fields.payee === 'required') return '對象名稱不能是空白;要清空請按「清空」。'
    if (fields.payee === 'not_found') return '選的對象已經不存在,請重新整理。'
    if (fields.payee) return '對象名稱太長。'
    if (fields.note) return '備註太長。'
    if (fields.tags) return '標籤不合法(名稱空白、太長,或選的標籤已經不存在)。'
    if (Object.keys(fields).some((key) => key.startsWith('categories'))) return '分類不合法,請重新整理後再選。'
    if (fields.postings?.startsWith('unbalanced')) return `借貸不平(${fields.postings.slice('unbalanced:'.length)}),沒有儲存。`
    if (fields.postings === 'too_few') return '至少要兩條分錄。'
    if (Object.keys(fields).some((key) => key.startsWith('postings'))) return '有分錄不合法(金額是 0、帳戶不存在,或幣別跟帳戶不符)。'
    return '輸入不合法。'
  }
  if (code === 'NOT_FOUND') return '這筆交易已經不存在。'
  if (code === 'NETWORK') return '連不到伺服器,沒有儲存。'
  return '伺服器發生錯誤,沒有儲存;詳細內容在伺服器的紀錄裡。'
}

// 管理頁(分類、收款人、規則、標籤、帳戶)的錯誤 → 給人看的訊息。fields 的值是伺服器回傳的原因代碼
const ADMIN_REASONS: Record<string, string> = {
  required: '名稱不能是空白。',
  too_long: '名稱太長。',
  duplicate: '已經有同名的了。',
  system: '系統分類不能這樣改。',
  has_children: '底下還有子分類,請先把子分類移走或合併。',
  has_transactions: '已經有交易用到,不能刪除;可以封存或合併到別的。',
  in_use: '還有規則或週期項目用到,不能刪除;可以合併到別的(會一起改指過去)。',
  type_mismatch: '類型不對(對象規則只能指到支出分類;合併要同類型)。',
  not_top_level: '只能放到最上層的分類底下(最多兩層)。',
  self: '不能選自己。',
  not_found: '選的項目已經不存在,請重新整理。',
  not_payee_rule: '這不是對象規則。',
  not_source_rule: '這不是來源分類規則。',
  not_uncategorized: '這筆交易已經不是未分類。',
}

export function adminErrorMessage(error: unknown): string {
  if (!(error instanceof FinanceApiError)) return '發生未預期的錯誤'
  if (error.code === 'VALIDATION_FAILED') {
    const reason = Object.values(error.fields)[0]
    return (reason && ADMIN_REASONS[reason]) ?? '輸入不合法。'
  }
  if (error.code === 'NOT_FOUND') return '這個項目已經不存在,請重新整理。'
  if (error.code === 'NETWORK') return '連不到伺服器,沒有儲存。'
  return '伺服器發生錯誤,沒有儲存;詳細內容在伺服器的紀錄裡。'
}
