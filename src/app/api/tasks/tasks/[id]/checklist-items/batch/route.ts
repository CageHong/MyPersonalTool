import { createChecklistItems } from '@/modules/tasks/server/checklist'
import { errorResponse, handleError, parseId, readJsonObject } from '@/app/api/_lib/http'

// 批次新增:body { titles: [...] },整批放在最後,整批成功才寫入
export async function POST(
  request: Request,
  ctx: RouteContext<'/api/tasks/tasks/[id]/checklist-items/batch'>,
): Promise<Response> {
  const taskId = parseId((await ctx.params).id, 'id')
  if (taskId instanceof Response) {
    return taskId
  }

  const body = await readJsonObject(request)
  if (!body) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Request body must be a JSON object', {
      body: 'invalid_json',
    })
  }

  try {
    // titles 的形狀與內容由 createChecklistItems 驗證
    return Response.json(createChecklistItems(taskId, body.titles as string[]), { status: 201 })
  } catch (error) {
    return handleError('[POST /api/tasks/tasks/[id]/checklist-items/batch]', error, 'Task not found')
  }
}
