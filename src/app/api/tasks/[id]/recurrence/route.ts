import { createRuleFromTask, type RuleSpecInput } from '@/server/recurrence'
import { todayIso } from '@/lib/date'
import { errorResponse, handleError, parseId, readJsonObject } from '@/app/api/_lib/http'

// 把任務變成重複規則的第一個實例。「今天」與 listTasks 相同:伺服器本地時區
export async function POST(
  request: Request,
  ctx: RouteContext<'/api/tasks/[id]/recurrence'>,
): Promise<Response> {
  const id = parseId((await ctx.params).id, 'id')
  if (id instanceof Response) {
    return id
  }

  const body = await readJsonObject(request)
  if (!body) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Request body must be a JSON object', {
      body: 'invalid_json',
    })
  }

  try {
    return Response.json(createRuleFromTask(id, body as RuleSpecInput, todayIso()), { status: 201 })
  } catch (error) {
    return handleError('[POST /api/tasks/[id]/recurrence]', error, 'Task not found')
  }
}
