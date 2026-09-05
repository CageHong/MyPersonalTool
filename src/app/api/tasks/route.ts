import {
  createTask,
  listTasks,
  NotFoundError,
  ValidationError,
  type CreateTaskInput,
} from '@/server/tasks'

function errorResponse(
  status: number,
  code: string,
  message: string,
  fields?: Record<string, string>,
): Response {
  return Response.json({ error: { code, message, ...(fields && { fields }) } }, { status })
}

function handleError(error: unknown): Response {
  if (error instanceof ValidationError) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Validation failed', error.fields)
  }
  if (error instanceof NotFoundError) {
    return errorResponse(404, 'NOT_FOUND', 'Task not found')
  }
  console.error('[POST /api/tasks]', error)
  return errorResponse(500, 'INTERNAL_ERROR', 'Internal server error')
}

// 合法 JSON 但不是物件("hello"、[1,2]、null)一樣不能餵給 createTask
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

export async function GET(): Promise<Response> {
  try {
    return Response.json(listTasks())
  } catch (error) {
    console.error('[GET /api/tasks]', error)
    return errorResponse(500, 'INTERNAL_ERROR', 'Internal server error')
  }
}

export async function POST(request: Request): Promise<Response> {
  const body = await readJsonObject(request)
  if (!body) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Request body must be a JSON object', {
      body: 'invalid_json',
    })
  }

  try {
    return Response.json(createTask(body as CreateTaskInput), { status: 201 })
  } catch (error) {
    return handleError(error)
  }
}
