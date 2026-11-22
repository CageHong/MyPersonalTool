import { createHabit, listHabits, type CreateHabitInput } from '@/modules/tasks/server/habits'
import { localDate } from '@/platform/date'
import { errorResponse, handleError, readJsonObject } from '@/app/api/_lib/http'

// 「今天」與 listTasks 相同:伺服器本地時區
export async function GET(): Promise<Response> {
  try {
    return Response.json(listHabits(localDate(new Date())))
  } catch (error) {
    console.error('[GET /api/tasks/habits]', error)
    return errorResponse(500, 'INTERNAL_ERROR', 'Internal server error')
  }
}

export async function POST(request: Request): Promise<Response> {
  const body = await readJsonObject(request)
  if (!body) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Request body must be a JSON object', {
      body: 'invalid_json',
    })
  }

  try {
    return Response.json(createHabit(body as CreateHabitInput, localDate(new Date())), { status: 201 })
  } catch (error) {
    return handleError('[POST /api/tasks/habits]', error, 'Habit not found')
  }
}
