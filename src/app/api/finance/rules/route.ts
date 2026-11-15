// 規則管理。GET:全部規則(依種類、優先順序);POST:新增,body 是 lib/rules.ts 的 RuleInput
import { getDb } from '@/modules/finance/db'
import { parseRuleInput } from '@/modules/finance/lib/rules'
import { createRule, listRules } from '@/modules/finance/server/classify/rules'
import { errorResponse, handleError, readJsonObject } from '@/app/api/_lib/http'
import { invalidBody } from '../_lib/parse'

export async function GET(): Promise<Response> {
  try {
    return Response.json({ rules: listRules(getDb()) })
  } catch (error) {
    return handleError('[GET /api/finance/rules]', error, 'Not found')
  }
}

export async function POST(request: Request): Promise<Response> {
  const body = await readJsonObject(request)
  if (!body) return invalidBody()
  const parsed = parseRuleInput(body)
  if (!parsed.ok) return errorResponse(400, 'VALIDATION_FAILED', 'Invalid rule', parsed.fields)
  try {
    return Response.json({ id: createRule(getDb(), parsed.value) }, { status: 201 })
  } catch (error) {
    return handleError('[POST /api/finance/rules]', error, 'Not found')
  }
}
