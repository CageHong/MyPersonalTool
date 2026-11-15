// 分類在同一層裡上移或下移一格。body:{ direction: 'up' | 'down' }
import { getDb } from '@/modules/finance/db'
import { moveCategory } from '@/modules/finance/server/ledger/categories'
import { errorResponse, handleError, readJsonObject } from '@/app/api/_lib/http'
import { invalidBody, parseRouteId } from '../../../_lib/parse'

export async function POST(request: Request, ctx: RouteContext<'/api/finance/categories/[id]/move'>): Promise<Response> {
  const id = parseRouteId((await ctx.params).id, 'category')
  if (id instanceof Response) return id
  const body = await readJsonObject(request)
  if (!body) return invalidBody()
  if (body.direction !== 'up' && body.direction !== 'down') {
    return errorResponse(400, 'VALIDATION_FAILED', 'Invalid direction', { direction: 'invalid' })
  }
  try {
    moveCategory(getDb(), id, body.direction)
    return new Response(null, { status: 204 })
  } catch (error) {
    return handleError('[POST /api/finance/categories/[id]/move]', error, 'Category not found')
  }
}
