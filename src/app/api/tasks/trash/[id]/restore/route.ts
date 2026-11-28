import { restoreTask } from '@/modules/tasks/server/trash'
import { handleError, parseId } from '@/app/api/_lib/http'

// 還原是動作,不是欄位更新,所以用 POST 子路徑;沒有 body
export async function POST(
  _request: Request,
  ctx: RouteContext<'/api/tasks/trash/[id]/restore'>,
): Promise<Response> {
  const id = parseId((await ctx.params).id, 'id')
  if (id instanceof Response) {
    return id
  }

  try {
    return Response.json(restoreTask(id))
  } catch (error) {
    return handleError('[POST /api/tasks/trash/[id]/restore]', error, 'Task not found')
  }
}
