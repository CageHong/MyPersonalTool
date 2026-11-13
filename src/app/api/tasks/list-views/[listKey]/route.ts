import { saveViewSettings } from '@/modules/tasks/server/listViews'
import type { ViewSettings } from '@/modules/tasks/lib/listView'
import { errorResponse, handleError, readJsonObject } from '@/app/api/_lib/http'

// 整份替換某個清單的分組與排序設定。listKey 是不是認得的清單屬於業務驗證,由 saveViewSettings 判斷
export async function PUT(
  request: Request,
  ctx: RouteContext<'/api/tasks/list-views/[listKey]'>,
): Promise<Response> {
  const { listKey } = await ctx.params

  const body = await readJsonObject(request)
  if (!body) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Request body must be a JSON object', {
      body: 'invalid_json',
    })
  }

  try {
    return Response.json(saveViewSettings(listKey, body as ViewSettings))
  } catch (error) {
    return handleError('[PUT /api/tasks/list-views/[listKey]]', error, 'List not found')
  }
}
