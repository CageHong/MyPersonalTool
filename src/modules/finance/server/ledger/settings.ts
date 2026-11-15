// 帳本的狀態旗標(存在 finance_settings)。
// v2 已停用:第一次在畫面上編輯交易時寫入;之後 finance:import-v2 拒絕執行,
// 因為它每次從空的資料庫重建,會洗掉畫面上做過的修改
import { eq } from 'drizzle-orm'
import type { FinanceConn } from '../../db/index'
import { financeSettings } from '../../db/schema'

const V2_RETIRED_KEY = 'v2_retired_at'

// 停用的時間(UTC);還沒停用是 null
export function getV2RetiredAt(db: FinanceConn): string | null {
  const row = db
    .select({ value: financeSettings.value })
    .from(financeSettings)
    .where(eq(financeSettings.key, V2_RETIRED_KEY))
    .get()
  return row?.value ?? null
}

// 已經停用時不變(保留第一次的時間)
export function markV2Retired(db: FinanceConn, now: string): void {
  db.insert(financeSettings).values({ key: V2_RETIRED_KEY, value: now }).onConflictDoNothing().run()
}
