// 淨資產與側欄的帳戶清單:API 回傳的形狀,前後端共用。金額都是最小貨幣單位(整數)

export type SidebarAccount = {
  id: number
  name: string
  type: 'asset' | 'liability'
  currency: string
  // 原幣;asset 正 = 有錢,liability 負 = 欠款
  balance: number
  isActive: boolean
}

export type SidebarGroup = {
  // null = 未分組
  id: number | null
  name: string
  // 合計的幣別(群組設定的,沒有就是顯示幣別)
  currency: string
  // 用最新匯率換算後的合計;群組裡有帳戶缺匯率時是 null
  total: number | null
  accounts: SidebarAccount[]
}

export type NetWorth = {
  currency: string
  // 幣別 → 小數位數(顯示金額用)
  exponents: Record<string, number>
  // 換算用的日期(今天,UTC);每個幣別取這一天或之前最近的匯率
  asOf: string
  // 所有資產 / 負債帳戶的合計(負債為負)
  netWorth: number
  // 可動用資金:現金及約當現金(子類型 cash、bank)的合計
  available: number
  groups: SidebarGroup[]
  // 缺匯率、沒有算進淨資產的帳戶數
  missingRate: number
}
