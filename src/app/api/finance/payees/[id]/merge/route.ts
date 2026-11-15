// 把這個收款人合併到另一個(交易、別名、規則、週期項目改指向目標,再刪掉這個)。body:{ targetId }
import { getDb } from '@/modules/finance/db'
import { mergePayee } from '@/modules/finance/server/ledger/payees'
import { errorResponse, handleError, readJsonObject } from '@/app/api/_lib/http'
import { invalidBody, parseRouteId } from '../../../_lib/parse'

export async function POST(request: Request, ctx: RouteContext<'/api/finance/payees/[id]/merge'>): Promise<Response> {
  const id = parseRouteId((await ctx.params).id, 'payee')
  if (id instanceof Response) return id
  const body = await readJsonObject(request)
  if (!body) return invalidBody()
  if (!Number.isSafeInteger(body.targetId) || (body.targetId as number) <= 0) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Invalid target', { targetId: 'invalid' })
  }
  try {
    mergePayee(getDb(), id, body.targetId as number)
    return new Response(null, { status: 204 })
  } catch (error) {
    return handleError('[POST /api/finance/payees/[id]/merge]', error, 'Payee not found')
  }
}
