import { errorResponse, handleError, readJsonObject } from '@/app/api/_lib/http'
import {
  getNotificationSettings,
  saveNotificationSettings,
  type NotificationSettings,
} from '@/modules/tasks/server/notifications'

export async function GET(): Promise<Response> {
  try {
    return Response.json(getNotificationSettings())
  } catch (error) {
    console.error('[GET /api/tasks/notification-settings]', error)
    return errorResponse(500, 'INTERNAL_ERROR', 'Internal server error')
  }
}

export async function PUT(request: Request): Promise<Response> {
  const body = await readJsonObject(request)
  if (!body) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Request body must be a JSON object', {
      body: 'invalid_json',
    })
  }

  try {
    return Response.json(saveNotificationSettings(body as NotificationSettings))
  } catch (error) {
    return handleError(
      '[PUT /api/tasks/notification-settings]',
      error,
      'Notification settings not found',
    )
  }
}
