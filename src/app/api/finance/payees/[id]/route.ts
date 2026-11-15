// 單一收款人。PATCH:改名 { name };DELETE:刪除(沒被交易、規則、週期項目用到才行)
import { getDb } from '@/modules/finance/db'
import { deletePayee, renamePayee } from '@/modules/finance/server/ledger/payees'
import { errorResponse, handleError, readJsonObject } from '@/app/api/_lib/http'
import { invalidBody, parseRouteId } from '../../_lib/parse'

export async function PATCH(request: Request, ctx: RouteContext<'/api/finance/payees/[id]'>): Promise<Response> {
  const id = parseRouteId((await ctx.params).id, 'payee')
  if (id instanceof Response) return id
  const body = await readJsonObject(request)
  if (!body) return invalidBody()
  if (typeof body.name !== 'string') return errorResponse(400, 'VALIDATION_FAILED', 'Invalid name', { name: 'required' })
  try {
    renamePayee(getDb(), id, body.name)
    return new Response(null, { status: 204 })
  } catch (error) {
    return handleError('[PATCH /api/finance/payees/[id]]', error, 'Payee not found')
  }
}

export async function DELETE(_request: Request, ctx: RouteContext<'/api/finance/payees/[id]'>): Promise<Response> {
  const id = parseRouteId((await ctx.params).id, 'payee')
  if (id instanceof Response) return id
  try {
    deletePayee(getDb(), id)
    return new Response(null, { status: 204 })
  } catch (error) {
    return handleError('[DELETE /api/finance/payees/[id]]', error, 'Payee not found')
  }
}
