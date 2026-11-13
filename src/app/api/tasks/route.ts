import { createTask, listTasks, type CreateTaskInput } from '@/modules/tasks/server/tasks'
import { errorResponse, handleError, readJsonObject } from '@/app/api/_lib/http'

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
    return handleError('[POST /api/tasks]', error, 'Task not found')
  }
}
