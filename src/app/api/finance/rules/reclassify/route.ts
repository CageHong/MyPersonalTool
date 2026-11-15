// 重新分類未分類的交易。GET:預覽(只讀);POST:套用選中的 { transactionIds },回傳 { applied, skipped }
import { getDb } from '@/modules/finance/db'
import { applyReclassify, planReclassify } from '@/modules/finance/server/classify/reclassify'
import { errorResponse, handleError, readJsonObject } from '@/app/api/_lib/http'
import { invalidBody } from '../../_lib/parse'

export async function GET(): Promise<Response> {
  try {
    return Response.json(planReclassify(getDb()))
  } catch (error) {
    return handleError('[GET /api/finance/rules/reclassify]', error, 'Not found')
  }
}

export async function POST(request: Request): Promise<Response> {
  const body = await readJsonObject(request)
  if (!body) return invalidBody()
  const ids = body.transactionIds
  if (!Array.isArray(ids) || !ids.every((id) => Number.isSafeInteger(id) && id > 0)) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Invalid transactionIds', { transactionIds: 'invalid' })
  }
  try {
    return Response.json(applyReclassify(getDb(), ids as number[]))
  } catch (error) {
    return handleError('[POST /api/finance/rules/reclassify]', error, 'Not found')
  }
}
