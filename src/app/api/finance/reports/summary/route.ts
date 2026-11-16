// 期間摘要。GET:網址參數跟交易清單相同(lib/transactions.ts 定義;cursor、limit、order 不影響結果),
// 回傳 lib/reports.ts 的 TransactionSummary
import { getDb } from '@/modules/finance/db'
import { parseTransactionFilter } from '@/modules/finance/lib/transactions'
import { summarizeTransactions } from '@/modules/finance/server/reports/summary'
import { errorResponse, handleError } from '@/app/api/_lib/http'

export async function GET(request: Request): Promise<Response> {
  const parsed = parseTransactionFilter(new URL(request.url).searchParams)
  if (!parsed.ok) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Invalid filter', parsed.fields)
  }
  try {
    return Response.json(summarizeTransactions(getDb(), parsed.filter))
  } catch (error) {
    return handleError('[GET /api/finance/reports/summary]', error, 'Not found')
  }
}
