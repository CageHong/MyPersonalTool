// 單一標籤。PATCH:改名、日期範圍;DELETE:刪除(交易上的這個標籤一起拿掉)
import { getDb } from '@/modules/finance/db'
import { parseTagInput } from '@/modules/finance/lib/tags'
import { deleteTag, updateTag } from '@/modules/finance/server/tags'
import { errorResponse, handleError, readJsonObject } from '@/app/api/_lib/http'
import { invalidBody, parseRouteId } from '../../_lib/parse'

export async function PATCH(request: Request, ctx: RouteContext<'/api/finance/tags/[id]'>): Promise<Response> {
  const id = parseRouteId((await ctx.params).id, 'tag')
  if (id instanceof Response) return id
  const body = await readJsonObject(request)
  if (!body) return invalidBody()
  const parsed = parseTagInput(body, true)
  if (!parsed.ok) return errorResponse(400, 'VALIDATION_FAILED', 'Invalid tag', parsed.fields)
  try {
    updateTag(getDb(), id, parsed.value)
    return new Response(null, { status: 204 })
  } catch (error) {
    return handleError('[PATCH /api/finance/tags/[id]]', error, 'Tag not found')
  }
}

export async function DELETE(_request: Request, ctx: RouteContext<'/api/finance/tags/[id]'>): Promise<Response> {
  const id = parseRouteId((await ctx.params).id, 'tag')
  if (id instanceof Response) return id
  try {
    deleteTag(getDb(), id)
    return new Response(null, { status: 204 })
  } catch (error) {
    return handleError('[DELETE /api/finance/tags/[id]]', error, 'Tag not found')
  }
}
