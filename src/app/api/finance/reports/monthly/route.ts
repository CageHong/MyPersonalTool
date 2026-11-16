// 每月報表。GET:網址參數跟交易清單相同(通常只給 from、to;cursor、limit、order 不影響結果),
// 回傳 lib/reports.ts 的 MonthlyReport
import { getDb } from '@/modules/finance/db'
import { parseTransactionFilter } from '@/modules/finance/lib/transactions'
import { monthlyReport } from '@/modules/finance/server/reports/monthly'
import { errorResponse, handleError } from '@/app/api/_lib/http'

export async function GET(request: Request): Promise<Response> {
  const parsed = parseTransactionFilter(new URL(request.url).searchParams)
  if (!parsed.ok) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Invalid filter', parsed.fields)
  }
  try {
    return Response.json(monthlyReport(getDb(), parsed.filter))
  } catch (error) {
    return handleError('[GET /api/finance/reports/monthly]', error, 'Not found')
  }
}
