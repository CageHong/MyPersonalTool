import { errorResponse } from '@/app/api/_lib/http'
import { listRules } from '@/modules/tasks/server/recurrence'

export async function GET(): Promise<Response> {
  try {
    return Response.json(listRules())
  } catch (error) {
    console.error('[GET /api/tasks/recurrence-rules]', error)
    return errorResponse(500, 'INTERNAL_ERROR', 'Internal server error')
  }
}
