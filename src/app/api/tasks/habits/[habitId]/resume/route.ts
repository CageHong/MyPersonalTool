import { resumeHabit } from '@/modules/tasks/server/habits'
import { todayIso } from '@/modules/tasks/lib/date'
import { handleError, parseId } from '@/app/api/_lib/http'

// 恢復是動作,不是欄位更新,所以用 POST 子路徑。沒有 body;未停止時回 400
export async function POST(
  _request: Request,
  ctx: RouteContext<'/api/tasks/habits/[habitId]/resume'>,
): Promise<Response> {
  const habitId = parseId((await ctx.params).habitId, 'habitId')
  if (habitId instanceof Response) {
    return habitId
  }

  try {
    return Response.json(resumeHabit(habitId, todayIso()))
  } catch (error) {
    return handleError('[POST /api/tasks/habits/[habitId]/resume]', error, 'Habit not found')
  }
}
