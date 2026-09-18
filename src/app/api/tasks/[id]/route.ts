import { deleteTask, updateTask, type UpdateTaskPatch } from '@/server/tasks'
import { errorResponse, handleError, parseId, readJsonObject } from '@/app/api/_lib/http'

export async function PATCH(
  request: Request,
  ctx: RouteContext<'/api/tasks/[id]'>,
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
    return Response.json(updateTask(id, body as UpdateTaskPatch))
  } catch (error) {
    return handleError('[PATCH /api/tasks/[id]]', error, 'Task not found')
  }
}

export async function DELETE(
  _request: Request,
  ctx: RouteContext<'/api/tasks/[id]'>,
): Promise<Response> {
  const id = parseId((await ctx.params).id, 'id')
  if (id instanceof Response) {
    return id
  }

  try {
    deleteTask(id)
    return new Response(null, { status: 204 })
  } catch (error) {
    return handleError('[DELETE /api/tasks/[id]]', error, 'Task not found')
  }
}
