import {
  deleteTask,
  NotFoundError,
  updateTask,
  ValidationError,
  type UpdateTaskPatch,
} from '@/server/tasks'

function errorResponse(
  status: number,
  code: string,
  message: string,
  fields?: Record<string, string>,
): Response {
  return Response.json({ error: { code, message, ...(fields && { fields }) } }, { status })
}

function handleError(label: string, error: unknown): Response {
  if (error instanceof ValidationError) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Validation failed', error.fields)
  }
  if (error instanceof NotFoundError) {
    return errorResponse(404, 'NOT_FOUND', 'Task not found')
  }
  console.error(label, error)
  return errorResponse(500, 'INTERNAL_ERROR', 'Internal server error')
}

// 網址參數轉成 src/server/ 函式簽章要求的 number;純解析,不是業務驗證
function parseId(raw: string): number | null {
  return /^\d+$/.test(raw) ? Number(raw) : null
}

async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return null
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return null
  }
  return body as Record<string, unknown>
}

export async function PATCH(
  request: Request,
  ctx: RouteContext<'/api/tasks/[id]'>,
): Promise<Response> {
  const id = parseId((await ctx.params).id)
  if (id === null) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Invalid task id', { id: 'invalid' })
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
    return handleError('[PATCH /api/tasks/[id]]', error)
  }
}

export async function DELETE(
  _request: Request,
  ctx: RouteContext<'/api/tasks/[id]'>,
): Promise<Response> {
  const id = parseId((await ctx.params).id)
  if (id === null) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Invalid task id', { id: 'invalid' })
  }

  try {
    deleteTask(id)
    return new Response(null, { status: 204 })
  } catch (error) {
    return handleError('[DELETE /api/tasks/[id]]', error)
  }
}
