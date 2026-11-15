// 交易清單。GET:網址參數是篩選條件(lib/transactions.ts 定義參數名)加上分頁的 cursor、limit,
// 回傳一頁交易與下一頁的 cursor。POST:手動新增一筆,body 是 lib/edit.ts 的 NewTransactionInput,回傳新的那一列(201)
import { getDb } from '@/modules/finance/db'
import { parseNewTransaction } from '@/modules/finance/lib/edit'
import { parseTransactionFilter } from '@/modules/finance/lib/transactions'
import { getTransactionRow, listTransactions } from '@/modules/finance/server/ledger/list'
import { createManualTransaction } from '@/modules/finance/server/ledger/transactions'
import { errorResponse, handleError, readJsonObject } from '@/app/api/_lib/http'
import { invalidBody } from '../_lib/parse'

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

export async function POST(request: Request): Promise<Response> {
  const body = await readJsonObject(request)
  if (!body) return invalidBody()
  const parsed = parseNewTransaction(body)
  if (!parsed.ok) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Invalid transaction', parsed.fields)
  }
  try {
    const db = getDb()
    const id = createManualTransaction(db, parsed.input)
    return Response.json(getTransactionRow(db, id), { status: 201 })
  } catch (error) {
    return handleError('[POST /api/finance/transactions]', error, 'Not found')
  }
}

