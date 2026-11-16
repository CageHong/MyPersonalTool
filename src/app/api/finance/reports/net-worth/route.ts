// 淨資產、可動用資金、側欄的帳戶清單。GET,沒有參數;用今天(UTC)或之前最近的匯率換算。
// 回傳 lib/net-worth.ts 的 NetWorth
import { getDb } from '@/modules/finance/db'
import { getNetWorth } from '@/modules/finance/server/reports/net-worth'
import { handleError } from '@/app/api/_lib/http'

export async function GET(): Promise<Response> {
  try {
    return Response.json(getNetWorth(getDb(), new Date().toISOString().slice(0, 10)))
  } catch (error) {
    return handleError('[GET /api/finance/reports/net-worth]', error, 'Not found')
  }
}
