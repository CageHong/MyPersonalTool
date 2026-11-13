import { listViewSettings } from '@/modules/tasks/server/listViews'
import { errorResponse } from '@/app/api/_lib/http'

export async function GET(): Promise<Response> {
  try {
    return Response.json(listViewSettings())
  } catch (error) {
    console.error('[GET /api/tasks/list-views]', error)
    return errorResponse(500, 'INTERNAL_ERROR', 'Internal server error')
  }
}
