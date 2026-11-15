// 資產 / 負債帳戶的管理。GET:全部(附餘額、交易筆數);POST:新增 { name, type, subtype, currency }
import { getDb } from '@/modules/finance/db'
import { parseBalanceAccountInput } from '@/modules/finance/lib/balance-accounts'
import { createBalanceAccount, listBalanceAccounts } from '@/modules/finance/server/ledger/balance-accounts'
import { errorResponse, handleError, readJsonObject } from '@/app/api/_lib/http'
import { invalidBody } from '../_lib/parse'

export async function GET(): Promise<Response> {
  try {
    return Response.json({ accounts: listBalanceAccounts(getDb()) })
  } catch (error) {
    return handleError('[GET /api/finance/accounts]', error, 'Not found')
  }
}

export async function POST(request: Request): Promise<Response> {
  const body = await readJsonObject(request)
  if (!body) return invalidBody()
  const parsed = parseBalanceAccountInput(body)
  if (!parsed.ok) return errorResponse(400, 'VALIDATION_FAILED', 'Invalid account', parsed.fields)
  try {
    return Response.json({ id: createBalanceAccount(getDb(), parsed.value) }, { status: 201 })
  } catch (error) {
    return handleError('[POST /api/finance/accounts]', error, 'Not found')
  }
}
