import { pauseHabit } from '@/server/habits'
import { todayIso } from '@/lib/date'
import { handleError, parseId } from '@/app/api/_lib/http'

// 停止是動作,不是欄位更新,所以用 POST 子路徑。沒有 body;已停止時回 400
export async function POST(
  _request: Request,
  ctx: RouteContext<'/api/habits/[habitId]/pause'>,
): Promise<Response> {
  const habitId = parseId((await ctx.params).habitId, 'habitId')
  if (habitId instanceof Response) {
    return habitId
  }

  try {
    return Response.json(pauseHabit(habitId, todayIso()))
  } catch (error) {
    return handleError('[POST /api/habits/[habitId]/pause]', error, 'Habit not found')
  }
}
