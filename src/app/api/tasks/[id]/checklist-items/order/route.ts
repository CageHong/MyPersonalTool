import { reorderChecklistItems } from '@/server/checklist'
import { errorResponse, handleError, parseId, readJsonObject } from '@/app/api/_lib/http'

export async function PUT(
  request: Request,
  ctx: RouteContext<'/api/tasks/[id]/checklist-items/order'>,
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
    // itemIds 是不是陣列、是否恰好是這個任務的全部項目,由 reorderChecklistItems 驗證
    return Response.json(reorderChecklistItems(taskId, body.itemIds as number[]))
  } catch (error) {
    return handleError('[PUT /api/tasks/[id]/checklist-items/order]', error, 'Task not found')
  }
}
