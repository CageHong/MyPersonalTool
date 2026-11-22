import { deleteReminder, updateReminder, type ReminderInput } from '@/modules/tasks/server/reminders'
import { errorResponse, handleError, parseId, readJsonObject } from '@/app/api/_lib/http'

export async function PUT(
  request: Request,
  ctx: RouteContext<'/api/tasks/reminders/[reminderId]'>,
): Promise<Response> {
  const reminderId = parseId((await ctx.params).reminderId, 'reminderId')
  if (reminderId instanceof Response) {
    return reminderId
  }

  const body = await readJsonObject(request)
  if (!body) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Request body must be a JSON object', {
      body: 'invalid_json',
    })
  }

  try {
    return Response.json(updateReminder(reminderId, body as ReminderInput, new Date()))
  } catch (error) {
    return handleError('[PUT /api/tasks/reminders/[reminderId]]', error, 'Reminder not found')
  }
}

export async function DELETE(
  _request: Request,
  ctx: RouteContext<'/api/tasks/reminders/[reminderId]'>,
): Promise<Response> {
  const reminderId = parseId((await ctx.params).reminderId, 'reminderId')
  if (reminderId instanceof Response) {
    return reminderId
  }

  try {
    deleteReminder(reminderId)
    return new Response(null, { status: 204 })
  } catch (error) {
    return handleError('[DELETE /api/tasks/reminders/[reminderId]]', error, 'Reminder not found')
  }
}
