import { addLog, removeLog } from '@/server/habits'
import { todayIso } from '@/lib/date'
import { errorResponse, handleError, parseId, readJsonObject } from '@/app/api/_lib/http'

export async function POST(
  request: Request,
  ctx: RouteContext<'/api/habits/[habitId]/logs'>,
): Promise<Response> {
  const habitId = parseId((await ctx.params).habitId, 'habitId')
  if (habitId instanceof Response) {
    return habitId
  }

  const body = await readJsonObject(request)
  if (!body) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Request body must be a JSON object', {
      body: 'invalid_json',
    })
  }

  try {
    return Response.json(addLog(habitId, body.date as string, todayIso()), { status: 201 })
  } catch (error) {
    return handleError('[POST /api/habits/[habitId]/logs]', error, 'Habit not found')
  }
}

// 日期放 query string,不放 body:DELETE 帶 body 不可靠。缺少時交給 removeLog 回 invalid_format
export async function DELETE(
  request: Request,
  ctx: RouteContext<'/api/habits/[habitId]/logs'>,
): Promise<Response> {
  const habitId = parseId((await ctx.params).habitId, 'habitId')
  if (habitId instanceof Response) {
    return habitId
  }

  const date = new URL(request.url).searchParams.get('date')

  try {
    removeLog(habitId, date as string)
    return new Response(null, { status: 204 })
  } catch (error) {
    return handleError('[DELETE /api/habits/[habitId]/logs]', error, 'Habit not found')
  }
}
