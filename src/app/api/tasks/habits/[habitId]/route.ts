import { deleteHabit, updateHabit, type UpdateHabitPatch } from '@/modules/tasks/server/habits'
import { localDate } from '@/platform/date'
import { errorResponse, handleError, parseId, readJsonObject } from '@/app/api/_lib/http'

export async function PATCH(
  request: Request,
  ctx: RouteContext<'/api/tasks/habits/[habitId]'>,
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
    return Response.json(updateHabit(habitId, body as UpdateHabitPatch, localDate(new Date())))
  } catch (error) {
    return handleError('[PATCH /api/tasks/habits/[habitId]]', error, 'Habit not found')
  }
}

export async function DELETE(
  _request: Request,
  ctx: RouteContext<'/api/tasks/habits/[habitId]'>,
): Promise<Response> {
  const habitId = parseId((await ctx.params).habitId, 'habitId')
  if (habitId instanceof Response) {
    return habitId
  }

  try {
    deleteHabit(habitId)
    return new Response(null, { status: 204 })
  } catch (error) {
    return handleError('[DELETE /api/tasks/habits/[habitId]]', error, 'Habit not found')
  }
}
