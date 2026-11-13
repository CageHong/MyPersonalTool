import { getRule, updateRule, type UpdateRuleChanges } from '@/modules/tasks/server/recurrence'
import { todayIso } from '@/modules/tasks/lib/date'
import { errorResponse, handleError, parseId, readJsonObject } from '@/app/api/_lib/http'

export async function GET(
  _request: Request,
  ctx: RouteContext<'/api/recurrence-rules/[ruleId]'>,
): Promise<Response> {
  const ruleId = parseId((await ctx.params).ruleId, 'ruleId')
  if (ruleId instanceof Response) {
    return ruleId
  }

  try {
    return Response.json(getRule(ruleId))
  } catch (error) {
    return handleError('[GET /api/recurrence-rules/[ruleId]]', error, 'Recurrence rule not found')
  }
}

export async function PATCH(
  request: Request,
  ctx: RouteContext<'/api/recurrence-rules/[ruleId]'>,
): Promise<Response> {
  const ruleId = parseId((await ctx.params).ruleId, 'ruleId')
  if (ruleId instanceof Response) {
    return ruleId
  }

  const body = await readJsonObject(request)
  if (!body) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Request body must be a JSON object', {
      body: 'invalid_json',
    })
  }

  try {
    return Response.json(updateRule(ruleId, body as UpdateRuleChanges, todayIso()))
  } catch (error) {
    return handleError('[PATCH /api/recurrence-rules/[ruleId]]', error, 'Recurrence rule not found')
  }
}
