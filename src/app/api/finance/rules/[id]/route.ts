// 單一規則。PATCH:修改(body 是 lib/rules.ts 的 RuleUpdate);DELETE:刪除
import { getDb } from '@/modules/finance/db'
import { parseRuleUpdate } from '@/modules/finance/lib/rules'
import { deleteRule, updateRule } from '@/modules/finance/server/classify/rules'
import { errorResponse, handleError, readJsonObject } from '@/app/api/_lib/http'
import { invalidBody, parseRouteId } from '../../_lib/parse'

export async function PATCH(request: Request, ctx: RouteContext<'/api/finance/rules/[id]'>): Promise<Response> {
  const id = parseRouteId((await ctx.params).id, 'rule')
  if (id instanceof Response) return id
  const body = await readJsonObject(request)
  if (!body) return invalidBody()
  const parsed = parseRuleUpdate(body)
  if (!parsed.ok) return errorResponse(400, 'VALIDATION_FAILED', 'Invalid rule', parsed.fields)
  try {
    updateRule(getDb(), id, parsed.value)
    return new Response(null, { status: 204 })
  } catch (error) {
    return handleError('[PATCH /api/finance/rules/[id]]', error, 'Rule not found')
  }
}

export async function DELETE(_request: Request, ctx: RouteContext<'/api/finance/rules/[id]'>): Promise<Response> {
  const id = parseRouteId((await ctx.params).id, 'rule')
  if (id instanceof Response) return id
  try {
    deleteRule(getDb(), id)
    return new Response(null, { status: 204 })
  } catch (error) {
    return handleError('[DELETE /api/finance/rules/[id]]', error, 'Rule not found')
  }
}
