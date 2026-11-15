// 旅行標籤的日期範圍。GET:範圍內還沒有這個標籤的交易(預覽);POST:把選中的加上標籤 { transactionIds }
import { getDb } from '@/modules/finance/db'
import { applyTagRange, previewTagRange } from '@/modules/finance/server/tags'
import { errorResponse, handleError, readJsonObject } from '@/app/api/_lib/http'
import { invalidBody, parseRouteId } from '../../../_lib/parse'

export async function GET(_request: Request, ctx: RouteContext<'/api/finance/tags/[id]/range'>): Promise<Response> {
  const id = parseRouteId((await ctx.params).id, 'tag')
  if (id instanceof Response) return id
  try {
    return Response.json({ items: previewTagRange(getDb(), id) })
  } catch (error) {
    return handleError('[GET /api/finance/tags/[id]/range]', error, 'Tag not found')
  }
}

export async function POST(request: Request, ctx: RouteContext<'/api/finance/tags/[id]/range'>): Promise<Response> {
  const id = parseRouteId((await ctx.params).id, 'tag')
  if (id instanceof Response) return id
  const body = await readJsonObject(request)
  if (!body) return invalidBody()
  const ids = body.transactionIds
  if (!Array.isArray(ids) || !ids.every((v) => Number.isSafeInteger(v) && v > 0)) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Invalid transactionIds', { transactionIds: 'invalid' })
  }
  try {
    return Response.json(applyTagRange(getDb(), id, ids as number[]))
  } catch (error) {
    return handleError('[POST /api/finance/tags/[id]/range]', error, 'Tag not found')
  }
}
