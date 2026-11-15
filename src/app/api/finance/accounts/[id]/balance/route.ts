// 資產 / 負債帳戶的餘額(對帳調整用)。網址參數 asOf(YYYY-MM-DD,以 UTC 切日):只算到那一天為止;不給 = 全部
import { getDb } from '@/modules/finance/db'
import { getAccountBalanceForInput } from '@/modules/finance/server/ledger/balances'
import { handleError } from '@/app/api/_lib/http'
import { parseRouteId } from '../../../_lib/parse'

export async function GET(
  request: Request,
  ctx: RouteContext<'/api/finance/accounts/[id]/balance'>,
): Promise<Response> {
  const id = parseRouteId((await ctx.params).id, 'account')
  if (id instanceof Response) return id
  const asOf = new URL(request.url).searchParams.get('asOf') ?? undefined
  try {
    return Response.json(getAccountBalanceForInput(getDb(), id, asOf))
  } catch (error) {
    return handleError('[GET /api/finance/accounts/[id]/balance]', error, 'Not found')
  }
}
