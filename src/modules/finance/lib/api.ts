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
