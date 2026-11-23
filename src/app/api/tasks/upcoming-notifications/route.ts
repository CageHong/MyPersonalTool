import { errorResponse } from '@/app/api/_lib/http'
import { upcomingTaskNotifications } from '@/modules/tasks/server/notifications'

export async function GET(): Promise<Response> {
  try {
    return Response.json(upcomingTaskNotifications(new Date()))
  } catch (error) {
    console.error('[GET /api/tasks/upcoming-notifications]', error)
    return errorResponse(500, 'INTERNAL_ERROR', 'Internal server error')
  }
}
