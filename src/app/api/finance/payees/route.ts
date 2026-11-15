// 收款人管理的清單:交易筆數、別名、規則與週期項目數量
import { getDb } from '@/modules/finance/db'
import { listPayeesForAdmin } from '@/modules/finance/server/ledger/payees'
import { handleError } from '@/app/api/_lib/http'

export async function GET(): Promise<Response> {
  try {
    return Response.json({ payees: listPayeesForAdmin(getDb()) })
  } catch (error) {
    return handleError('[GET /api/finance/payees]', error, 'Not found')
  }
}
