// 單一資產 / 負債帳戶。PATCH:改名、子類型、封存(幣別不能改)
import { getDb } from '@/modules/finance/db'
import { parseBalanceAccountUpdate } from '@/modules/finance/lib/balance-accounts'
import { updateBalanceAccount } from '@/modules/finance/server/ledger/balance-accounts'
import { errorResponse, handleError, readJsonObject } from '@/app/api/_lib/http'
import { invalidBody, parseRouteId } from '../../_lib/parse'

export async function PATCH(request: Request, ctx: RouteContext<'/api/finance/accounts/[id]'>): Promise<Response> {
  const id = parseRouteId((await ctx.params).id, 'account')
  if (id instanceof Response) return id
  const body = await readJsonObject(request)
  if (!body) return invalidBody()
  const parsed = parseBalanceAccountUpdate(body)
  if (!parsed.ok) return errorResponse(400, 'VALIDATION_FAILED', 'Invalid account', parsed.fields)
  try {
    updateBalanceAccount(getDb(), id, parsed.value)
    return new Response(null, { status: 204 })
  } catch (error) {
    return handleError('[PATCH /api/finance/accounts/[id]]', error, 'Account not found')
  }
}
