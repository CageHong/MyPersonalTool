// 資產 / 負債帳戶的餘額(對帳調整用)。網址參數 asOf(YYYY-MM-DD,以 UTC 切日):只算到那一天為止;不給 = 全部
import { getDb } from '@/modules/finance/db'
import { getAccountBalanceForInput } from '@/modules/finance/server/ledger/balances'
import { errorResponse, handleError } from '@/app/api/_lib/http'

export async function GET(
  request: Request,
  ctx: RouteContext<'/api/finance/accounts/[id]/balance'>,
): Promise<Response> {
  const raw = (await ctx.params).id
  if (!/^\d+$/.test(raw)) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Invalid account id', { id: 'invalid' })
  }
  const asOf = new URL(request.url).searchParams.get('asOf') ?? undefined
  try {
    return Response.json(getAccountBalanceForInput(getDb(), Number(raw), asOf))
  } catch (error) {
    return handleError('[GET /api/finance/accounts/[id]/balance]', error, 'Not found')
  }
}
