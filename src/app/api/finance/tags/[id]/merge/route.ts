// 把這個標籤合併到另一個(交易都加上目標標籤,再刪掉這個)。body:{ targetId }
import { getDb } from '@/modules/finance/db'
import { mergeTag } from '@/modules/finance/server/tags'
import { errorResponse, handleError, readJsonObject } from '@/app/api/_lib/http'
import { invalidBody, parseRouteId } from '../../../_lib/parse'

export async function POST(request: Request, ctx: RouteContext<'/api/finance/tags/[id]/merge'>): Promise<Response> {
  const id = parseRouteId((await ctx.params).id, 'tag')
  if (id instanceof Response) return id
  const body = await readJsonObject(request)
  if (!body) return invalidBody()
  if (!Number.isSafeInteger(body.targetId) || (body.targetId as number) <= 0) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Invalid target', { targetId: 'invalid' })
  }
  try {
    mergeTag(getDb(), id, body.targetId as number)
    return new Response(null, { status: 204 })
  } catch (error) {
    return handleError('[POST /api/finance/tags/[id]/merge]', error, 'Tag not found')
  }
}
