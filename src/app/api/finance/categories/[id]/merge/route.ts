// 把這個分類合併到另一個(分錄、規則、週期項目改指向目標,再刪掉這個)。body:{ targetId }
import { getDb } from '@/modules/finance/db'
import { mergeCategory } from '@/modules/finance/server/ledger/categories'
import { errorResponse, handleError, readJsonObject } from '@/app/api/_lib/http'
import { invalidBody, parseRouteId } from '../../../_lib/parse'

export async function POST(request: Request, ctx: RouteContext<'/api/finance/categories/[id]/merge'>): Promise<Response> {
  const id = parseRouteId((await ctx.params).id, 'category')
  if (id instanceof Response) return id
  const body = await readJsonObject(request)
  if (!body) return invalidBody()
  if (!Number.isSafeInteger(body.targetId) || (body.targetId as number) <= 0) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Invalid target', { targetId: 'invalid' })
  }
  try {
    mergeCategory(getDb(), id, body.targetId as number)
    return new Response(null, { status: 204 })
  } catch (error) {
    return handleError('[POST /api/finance/categories/[id]/merge]', error, 'Category not found')
  }
}
