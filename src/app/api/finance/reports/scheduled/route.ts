// 固定支出報表。GET:網址參數跟交易清單相同(報表頁只送 from、to),回傳 lib/reports.ts 的 ScheduledReport
import { getDb } from '@/modules/finance/db'
import { parseTransactionFilter } from '@/modules/finance/lib/transactions'
import { scheduledReport } from '@/modules/finance/server/reports/scheduled'
import { errorResponse, handleError } from '@/app/api/_lib/http'

export async function GET(request: Request): Promise<Response> {
  const parsed = parseTransactionFilter(new URL(request.url).searchParams)
  if (!parsed.ok) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Invalid filter', parsed.fields)
  }
  try {
    return Response.json(scheduledReport(getDb(), parsed.filter))
  } catch (error) {
    return handleError('[GET /api/finance/reports/scheduled]', error, 'Not found')
  }
}
