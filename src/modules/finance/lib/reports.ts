// 報表:API 回傳的形狀,前後端共用。金額都是顯示幣別的最小貨幣單位(整數)

export type SummaryCategory = {
  id: number
  name: string
  // 含子分類;退款多於支出時可能是負數
  amount: number
  children: { id: number; name: string; amount: number }[]
}

// 一組篩選條件的期間摘要(交易清單上方)
export type TransactionSummary = {
  currency: string
  // 支出為正(退款沖減);固定 = 配對到週期項目的交易
  expense: { total: number; fixed: number; variable: number }
  income: number
  // 收入 − 支出
  net: number
  expenseCategories: SummaryCategory[]
  incomeCategories: SummaryCategory[]
  // 算進摘要的交易筆數(至少有一條被加總的分類分錄)
  transactionCount: number
  // 缺匯率、沒有算進去的交易筆數
  missingRate: number
}
