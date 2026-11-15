// finance 的 route handler 共用的協定層解析
import { errorResponse } from '@/app/api/_lib/http'

// 網址上的 id;不合法時回傳 400 的 Response,呼叫端用 instanceof Response 判斷後原樣回傳
export function parseRouteId(raw: string, what: string): number | Response {
  if (/^[1-9]\d*$/.test(raw)) return Number(raw)
  return errorResponse(400, 'VALIDATION_FAILED', `Invalid ${what} id`, { id: 'invalid' })
}

export function invalidBody(): Response {
  return errorResponse(400, 'VALIDATION_FAILED', 'Request body must be a JSON object', { body: 'invalid_json' })
}
