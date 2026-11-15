// 交易清單:網址參數是篩選條件(lib/transactions.ts 定義參數名)加上分頁的 cursor、limit。
// 回傳一頁交易與下一頁的 cursor
import { getDb } from '@/modules/finance/db'
import { parseTransactionFilter } from '@/modules/finance/lib/transactions'
import { listTransactions } from '@/modules/finance/server/ledger/list'
import { errorResponse, handleError } from '@/app/api/_lib/http'

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams
  const parsed = parseTransactionFilter(params)
  if (!parsed.ok) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Invalid filter', parsed.fields)
  }
  // 分頁參數只做型別轉換;範圍與 cursor 的內容由 listTransactions 驗證
  const rawLimit = params.get('limit')
  if (rawLimit !== null && !/^\d+$/.test(rawLimit)) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Invalid limit', { limit: 'invalid' })
  }
  const page = {
    cursor: params.get('cursor') ?? undefined,
    limit: rawLimit === null ? undefined : Number(rawLimit),
  }
  try {
    return Response.json(listTransactions(getDb(), parsed.filter, page))
  } catch (error) {
    return handleError('[GET /api/finance/transactions]', error, 'Not found')
  }
}
