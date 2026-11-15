// 分類管理。GET:全部分類(上層後面接子分類,附使用次數);POST:新增,body 是 lib/categories.ts 的 CategoryCreate
import { getDb } from '@/modules/finance/db'
import { parseCategoryCreate } from '@/modules/finance/lib/categories'
import { createCategory, listCategories } from '@/modules/finance/server/ledger/categories'
import { errorResponse, handleError, readJsonObject } from '@/app/api/_lib/http'
import { invalidBody } from '../_lib/parse'

export async function GET(): Promise<Response> {
  try {
    return Response.json({ categories: listCategories(getDb()) })
  } catch (error) {
    return handleError('[GET /api/finance/categories]', error, 'Not found')
  }
}

export async function POST(request: Request): Promise<Response> {
  const body = await readJsonObject(request)
  if (!body) return invalidBody()
  const parsed = parseCategoryCreate(body)
  if (!parsed.ok) return errorResponse(400, 'VALIDATION_FAILED', 'Invalid category', parsed.fields)
  try {
    const id = createCategory(getDb(), parsed.value)
    return Response.json({ id }, { status: 201 })
  } catch (error) {
    return handleError('[POST /api/finance/categories]', error, 'Not found')
  }
}
