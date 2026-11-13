import { stopRule } from '@/modules/tasks/server/recurrence'
import { todayIso } from '@/modules/tasks/lib/date'
import { handleError, parseId } from '@/app/api/_lib/http'

// 停止重複是動作,不是欄位更新,所以用 POST 子路徑而不是 PATCH endedAt。冪等,沒有 body
export async function POST(
  _request: Request,
  ctx: RouteContext<'/api/tasks/recurrence-rules/[ruleId]/stop'>,
): Promise<Response> {
  const ruleId = parseId((await ctx.params).ruleId, 'ruleId')
  if (ruleId instanceof Response) {
    return ruleId
  }

  try {
    return Response.json(stopRule(ruleId, todayIso()))
  } catch (error) {
    return handleError('[POST /api/tasks/recurrence-rules/[ruleId]/stop]', error, 'Recurrence rule not found')
  }
}
