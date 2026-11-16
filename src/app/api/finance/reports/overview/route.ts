// 總覽頁。GET ?today=YYYY-MM-DD(瀏覽器的今天,用來切本月;省略 = 伺服器的 UTC 今天),
// 回傳 lib/reports.ts 的 Overview
import { getDb } from '@/modules/finance/db'
import { getOverview } from '@/modules/finance/server/reports/overview'
import { errorResponse, handleError } from '@/app/api/_lib/http'

export async function GET(request: Request): Promise<Response> {
  const raw = new URL(request.url).searchParams.get('today')
  if (raw !== null && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Invalid today', { today: 'invalid' })
  }
  try {
    return Response.json(getOverview(getDb(), raw ?? new Date().toISOString().slice(0, 10)))
  } catch (error) {
    return handleError('[GET /api/finance/reports/overview]', error, 'Not found')
  }
}
