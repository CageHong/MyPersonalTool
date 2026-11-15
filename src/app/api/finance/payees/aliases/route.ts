// 收款人的別名。PATCH:移到另一個收款人 { alias, payeeId };DELETE:刪除 { alias }
import { getDb } from '@/modules/finance/db'
import { deleteAlias, moveAlias } from '@/modules/finance/server/ledger/payees'
import { errorResponse, handleError, readJsonObject } from '@/app/api/_lib/http'
import { invalidBody } from '../../_lib/parse'

export async function PATCH(request: Request): Promise<Response> {
  const body = await readJsonObject(request)
  if (!body) return invalidBody()
  if (typeof body.alias !== 'string' || !Number.isSafeInteger(body.payeeId)) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Invalid alias move', { alias: 'invalid' })
  }
  try {
    moveAlias(getDb(), body.alias, body.payeeId as number)
    return new Response(null, { status: 204 })
  } catch (error) {
    return handleError('[PATCH /api/finance/payees/aliases]', error, 'Payee not found')
  }
}

export async function DELETE(request: Request): Promise<Response> {
  const body = await readJsonObject(request)
  if (!body) return invalidBody()
  if (typeof body.alias !== 'string') return errorResponse(400, 'VALIDATION_FAILED', 'Invalid alias', { alias: 'invalid' })
  try {
    deleteAlias(getDb(), body.alias)
    return new Response(null, { status: 204 })
  } catch (error) {
    return handleError('[DELETE /api/finance/payees/aliases]', error, 'Not found')
  }
}
