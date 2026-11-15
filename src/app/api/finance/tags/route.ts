// 標籤管理。GET:全部標籤(附交易筆數);POST:新增 { name, startsOn, endsOn }
import { getDb } from '@/modules/finance/db'
import { parseTagInput } from '@/modules/finance/lib/tags'
import type { TagInput } from '@/modules/finance/lib/tags'
import { createTag, listTagsForAdmin } from '@/modules/finance/server/tags'
import { errorResponse, handleError, readJsonObject } from '@/app/api/_lib/http'
import { invalidBody } from '../_lib/parse'

export async function GET(): Promise<Response> {
  try {
    return Response.json({ tags: listTagsForAdmin(getDb()) })
  } catch (error) {
    return handleError('[GET /api/finance/tags]', error, 'Not found')
  }
}

export async function POST(request: Request): Promise<Response> {
  const body = await readJsonObject(request)
  if (!body) return invalidBody()
  const parsed = parseTagInput(body, false)
  if (!parsed.ok) return errorResponse(400, 'VALIDATION_FAILED', 'Invalid tag', parsed.fields)
  try {
    return Response.json({ id: createTag(getDb(), parsed.value as TagInput) }, { status: 201 })
  } catch (error) {
    return handleError('[POST /api/finance/tags]', error, 'Not found')
  }
}
