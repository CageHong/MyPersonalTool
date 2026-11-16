// 旅行報表。GET,沒有參數;回傳 lib/reports.ts 的 TripReport
import { getDb } from '@/modules/finance/db'
import { tripReport } from '@/modules/finance/server/reports/trips'
import { handleError } from '@/app/api/_lib/http'

export async function GET(): Promise<Response> {
  try {
    return Response.json(tripReport(getDb()))
  } catch (error) {
    return handleError('[GET /api/finance/reports/trips]', error, 'Not found')
  }
}
