// 規則在同一種(對象 / 來源分類)裡上移或下移一格。body:{ direction: 'up' | 'down' }
import { getDb } from '@/modules/finance/db'
import { moveRule } from '@/modules/finance/server/classify/rules'
import { errorResponse, handleError, readJsonObject } from '@/app/api/_lib/http'
import { invalidBody, parseRouteId } from '../../../_lib/parse'

export async function POST(request: Request, ctx: RouteContext<'/api/finance/rules/[id]/move'>): Promise<Response> {
  const id = parseRouteId((await ctx.params).id, 'rule')
  if (id instanceof Response) return id
  const body = await readJsonObject(request)
  if (!body) return invalidBody()
  if (body.direction !== 'up' && body.direction !== 'down') {
    return errorResponse(400, 'VALIDATION_FAILED', 'Invalid direction', { direction: 'invalid' })
  }
  try {
    moveRule(getDb(), id, body.direction)
    return new Response(null, { status: 204 })
  } catch (error) {
    return handleError('[POST /api/finance/rules/[id]/move]', error, 'Rule not found')
  }
}
