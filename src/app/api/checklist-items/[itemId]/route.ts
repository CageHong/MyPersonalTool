import {
  deleteChecklistItem,
  updateChecklistItem,
  type UpdateChecklistItemPatch,
} from '@/modules/tasks/server/checklist'
import { errorResponse, handleError, parseId, readJsonObject } from '@/app/api/_lib/http'

export async function PATCH(
  request: Request,
  ctx: RouteContext<'/api/checklist-items/[itemId]'>,
): Promise<Response> {
  const itemId = parseId((await ctx.params).itemId, 'itemId')
  if (itemId instanceof Response) {
    return itemId
  }

  const body = await readJsonObject(request)
  if (!body) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Request body must be a JSON object', {
      body: 'invalid_json',
    })
  }

  try {
    return Response.json(updateChecklistItem(itemId, body as UpdateChecklistItemPatch))
  } catch (error) {
    return handleError('[PATCH /api/checklist-items/[itemId]]', error, 'Checklist item not found')
  }
}

export async function DELETE(
  _request: Request,
  ctx: RouteContext<'/api/checklist-items/[itemId]'>,
): Promise<Response> {
  const itemId = parseId((await ctx.params).itemId, 'itemId')
  if (itemId instanceof Response) {
    return itemId
  }

  try {
    deleteChecklistItem(itemId)
    return new Response(null, { status: 204 })
  } catch (error) {
    return handleError('[DELETE /api/checklist-items/[itemId]]', error, 'Checklist item not found')
  }
}
