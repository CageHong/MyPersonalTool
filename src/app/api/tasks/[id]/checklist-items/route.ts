import { createChecklistItem, listChecklistItems } from '@/server/checklist'
import { errorResponse, handleError, parseId, readJsonObject } from '@/app/api/_lib/http'

export async function GET(
  _request: Request,
  ctx: RouteContext<'/api/tasks/[id]/checklist-items'>,
): Promise<Response> {
  const taskId = parseId((await ctx.params).id, 'id')
  if (taskId instanceof Response) {
    return taskId
  }

  try {
    return Response.json(listChecklistItems(taskId))
  } catch (error) {
    return handleError('[GET /api/tasks/[id]/checklist-items]', error, 'Task not found')
  }
}

export async function POST(
  request: Request,
  ctx: RouteContext<'/api/tasks/[id]/checklist-items'>,
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
    // title 與 afterItemId 的型別、內容由 createChecklistItem 驗證
    return Response.json(
      createChecklistItem(taskId, body.title as string, body.afterItemId as number | undefined),
      { status: 201 },
    )
  } catch (error) {
    return handleError('[POST /api/tasks/[id]/checklist-items]', error, 'Task not found')
  }
}
