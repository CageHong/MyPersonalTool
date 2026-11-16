// 帳戶群組與群組裡的資產 / 負債帳戶(唯讀),依群組順序、群組內順序。側欄的帳戶清單用。
// 群組的編輯在里程碑 c
import { sql } from 'drizzle-orm'
import type { FinanceConn } from '../../db/index'

export type AccountGroupRow = {
  id: number
  name: string
  // 群組合計的幣別;null = 顯示幣別
  currency: string | null
}

export type GroupedAccountRow = {
  id: number
  name: string
  type: 'asset' | 'liability'
  subtype: string | null
  currency: string
  isActive: boolean
  // null = 未分組
  groupId: number | null
}

export function listAccountGroups(db: FinanceConn): { groups: AccountGroupRow[]; accounts: GroupedAccountRow[] } {
  const groups = db.all<AccountGroupRow>(
    sql`SELECT id, name, currency FROM finance_account_groups ORDER BY sort_order, id`,
  )
  const accounts = db
    .all<Omit<GroupedAccountRow, 'isActive'> & { isActive: number }>(sql`
      SELECT id, name, type, subtype, currency, is_active AS isActive, group_id AS groupId
      FROM finance_accounts WHERE type IN ('asset', 'liability')
      ORDER BY sort_order, id`)
    .map((row) => ({ ...row, isActive: Boolean(row.isActive) }))
  return { groups, accounts }
}
