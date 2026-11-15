// 單筆交易。GET:那一列(跟清單同一個形狀,編輯面板打開時用);
// PATCH:編輯(含整組替換分錄),body 是 lib/edit.ts 的 TransactionPatch,成功時回傳改好的那一列;
// DELETE:刪除,網址參數 expectedUpdatedAt 是打開時拿到的 updatedAt,成功時回 204
import { getDb } from '@/modules/finance/db'
import { parseTransactionPatch } from '@/modules/finance/lib/edit'
import { getTransactionRow } from '@/modules/finance/server/ledger/list'
import { deleteTransaction, updateTransaction } from '@/modules/finance/server/ledger/transactions'
import { errorResponse, handleError, readJsonObject } from '@/app/api/_lib/http'

// 網址上的 id;不合法時回傳 400 的 Response
function parseTransactionId(raw: string): number | Response {
  if (/^\d+$/.test(raw)) return Number(raw)
  return errorResponse(400, 'VALIDATION_FAILED', 'Invalid transaction id', { id: 'invalid' })
}

export async function GET(
  _request: Request,
  ctx: RouteContext<'/api/finance/transactions/[id]'>,
): Promise<Response> {
  const id = parseTransactionId((await ctx.params).id)
  if (id instanceof Response) return id
  try {
    return Response.json(getTransactionRow(getDb(), id))
  } catch (error) {
    return handleError('[GET /api/finance/transactions/[id]]', error, 'Transaction not found')
  }
}

export async function PATCH(
  request: Request,
  ctx: RouteContext<'/api/finance/transactions/[id]'>,
): Promise<Response> {
  const id = parseTransactionId((await ctx.params).id)
  if (id instanceof Response) return id
  const body = await readJsonObject(request)
  if (!body) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Request body must be a JSON object', { body: 'invalid_json' })
  }
  const parsed = parseTransactionPatch(body)
  if (!parsed.ok) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Invalid patch', parsed.fields)
  }
  try {
    const db = getDb()
    updateTransaction(db, id, parsed.patch)
    return Response.json(getTransactionRow(db, id))
  } catch (error) {
    return handleError('[PATCH /api/finance/transactions/[id]]', error, 'Transaction not found')
  }
}

export async function DELETE(
  request: Request,
  ctx: RouteContext<'/api/finance/transactions/[id]'>,
): Promise<Response> {
  const id = parseTransactionId((await ctx.params).id)
  if (id instanceof Response) return id
  const expected = new URL(request.url).searchParams.get('expectedUpdatedAt')
  if (!expected) {
    return errorResponse(400, 'VALIDATION_FAILED', 'expectedUpdatedAt is required', { expectedUpdatedAt: 'required' })
  }
  try {
    deleteTransaction(getDb(), id, expected)
    return new Response(null, { status: 204 })
  } catch (error) {
    return handleError('[DELETE /api/finance/transactions/[id]]', error, 'Transaction not found')
  }
}

