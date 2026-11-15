// 刪掉過的匯入交易。GET:清單(附刪除當時的摘要);DELETE:取消刪除 { externalId },下次匯入會重新加進來
import { getDb } from '@/modules/finance/db'
import { forgetDeletedImport, listDeletedImports } from '@/modules/finance/server/ledger/transactions'
import { errorResponse, handleError, readJsonObject } from '@/app/api/_lib/http'
import { invalidBody } from '../../_lib/parse'

export async function GET(): Promise<Response> {
  try {
    return Response.json({ items: listDeletedImports(getDb()) })
  } catch (error) {
    return handleError('[GET /api/finance/import/deleted]', error, 'Not found')
  }
}

export async function DELETE(request: Request): Promise<Response> {
  const body = await readJsonObject(request)
  if (!body) return invalidBody()
  if (typeof body.externalId !== 'string' || body.externalId === '') {
    return errorResponse(400, 'VALIDATION_FAILED', 'Invalid externalId', { externalId: 'invalid' })
  }
  try {
    forgetDeletedImport(getDb(), body.externalId)
    return new Response(null, { status: 204 })
  } catch (error) {
    return handleError('[DELETE /api/finance/import/deleted]', error, 'Not found')
  }
}
