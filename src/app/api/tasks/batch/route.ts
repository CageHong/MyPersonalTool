import { createTasks, type CreateTaskInput } from '@/modules/tasks/server/tasks'
import { errorResponse, handleError, readJsonObject } from '@/app/api/_lib/http'

// 批次建立:body { tasks: [...] },整批成功才寫入
export async function POST(request: Request): Promise<Response> {
  const body = await readJsonObject(request)
  if (!body) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Request body must be a JSON object', {
      body: 'invalid_json',
    })
  }

  try {
    // tasks 的形狀與內容由 createTasks 驗證
    return Response.json(createTasks(body.tasks as CreateTaskInput[]), { status: 201 })
  } catch (error) {
    return handleError('[POST /api/tasks/batch]', error, 'Task not found')
  }
}
