// 篩選選單、編輯面板與金額顯示用的參考資料:帳戶與分類、標籤、收款人、系統帳戶、幣別的小數位數、顯示幣別
import { getDb } from '@/modules/finance/db'
import type { FinanceLookups } from '@/modules/finance/lib/transactions'
import {
  getCurrencyExponents,
  getDisplayCurrency,
  listAccounts,
  listPayees,
} from '@/modules/finance/server/ledger/lookups'
import { getSystemAccounts } from '@/modules/finance/server/ledger/accounts'
import { listTags } from '@/modules/finance/server/tags'
import { handleError } from '@/app/api/_lib/http'

export async function GET(): Promise<Response> {
  try {
    const db = getDb()
    const lookups: FinanceLookups = {
      displayCurrency: getDisplayCurrency(db),
      exponents: getCurrencyExponents(db),
      accounts: listAccounts(db),
      tags: listTags(db),
      payees: listPayees(db),
      system: getSystemAccounts(db),
    }
    return Response.json(lookups)
  } catch (error) {
    return handleError('[GET /api/finance/lookups]', error, 'Not found')
  }
}
