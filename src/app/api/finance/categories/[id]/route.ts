// 單一分類。PATCH:改名、換上層、封存(body 是 lib/categories.ts 的 CategoryUpdate);DELETE:刪除(沒被用到才行)
import { getDb } from '@/modules/finance/db'
import { parseCategoryUpdate } from '@/modules/finance/lib/categories'
import { deleteCategory, updateCategory } from '@/modules/finance/server/ledger/categories'
import { errorResponse, handleError, readJsonObject } from '@/app/api/_lib/http'
import { invalidBody, parseRouteId } from '../../_lib/parse'

export async function PATCH(request: Request, ctx: RouteContext<'/api/finance/categories/[id]'>): Promise<Response> {
  const id = parseRouteId((await ctx.params).id, 'category')
  if (id instanceof Response) return id
  const body = await readJsonObject(request)
  if (!body) return invalidBody()
  const parsed = parseCategoryUpdate(body)
  if (!parsed.ok) return errorResponse(400, 'VALIDATION_FAILED', 'Invalid category', parsed.fields)
  try {
    updateCategory(getDb(), id, parsed.value)
    return new Response(null, { status: 204 })
  } catch (error) {
    return handleError('[PATCH /api/finance/categories/[id]]', error, 'Category not found')
  }
}

export async function DELETE(_request: Request, ctx: RouteContext<'/api/finance/categories/[id]'>): Promise<Response> {
  const id = parseRouteId((await ctx.params).id, 'category')
  if (id instanceof Response) return id
  try {
    deleteCategory(getDb(), id)
    return new Response(null, { status: 204 })
  } catch (error) {
    return handleError('[DELETE /api/finance/categories/[id]]', error, 'Category not found')
  }
}
