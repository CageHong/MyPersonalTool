import { purgeTask } from '@/modules/tasks/server/trash'
import { handleError, parseId } from '@/app/api/_lib/http'

export async function DELETE(
  _request: Request,
  ctx: RouteContext<'/api/tasks/trash/[id]'>,
): Promise<Response> {
  const id = parseId((await ctx.params).id, 'id')
  if (id instanceof Response) {
    return id
  }

  try {
    purgeTask(id)
    return new Response(null, { status: 204 })
  } catch (error) {
    return handleError('[DELETE /api/tasks/trash/[id]]', error, 'Task not found')
  }
}
