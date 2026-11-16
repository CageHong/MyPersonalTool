// 報表:API 回傳的形狀,前後端共用。金額都是顯示幣別的最小貨幣單位(整數)
import type { NetWorth } from './net-worth'

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

export type ReportAmounts = {
  expense: { total: number; fixed: number; variable: number }
  income: number
  net: number
}

// 每月報表(報表頁)
export type MonthlyReport = {
  currency: string
  // 幣別 → 小數位數(顯示金額用)
  exponents: Record<string, number>
  // 實際用到的期間(沒給開始或結束時,從第一筆或到最後一筆交易的那個月)
  from: string | null
  to: string | null
  // 期間內的每個月(含沒有交易的月份),由舊到新
  months: (ReportAmounts & { month: string; transactionCount: number })[]
  total: ReportAmounts
  // 合計 ÷ 月數,四捨五入
  average: ReportAmounts
  expenseCategories: SummaryCategory[]
  incomeCategories: SummaryCategory[]
  missingRate: number
}

// 固定支出報表的一列(一個週期項目)
export type ScheduledReportItem = {
  id: number
  name: string
  category: { id: number; name: string; parentName: string | null }
  payee: string
  // 預期金額的範圍(原幣,最小貨幣單位)
  amountMin: number
  amountMax: number
  currency: string
  frequency: 'weekly' | 'monthly' | 'yearly'
  interval: number
  isActive: boolean
  // 期間內配對到的交易
  count: number
  // 顯示幣別
  total: number
  // total ÷ 期間的月數
  perMonth: number
  // 期間內最近一筆(UTC 的 ISO 8601);沒有是 null
  lastAt: string | null
}

export type ScheduledReport = {
  currency: string
  exponents: Record<string, number>
  from: string | null
  to: string | null
  months: number
  // 啟用中的在前,各自依合計由大到小;停用、期間內又沒有交易的不列
  items: ScheduledReportItem[]
  total: number
  perMonth: number
  missingRate: number
}

// 旅行報表的一趟(有日期範圍的標籤)
export type TripReportItem = {
  tagId: number
  name: string
  startsOn: string | null
  endsOn: string | null
  transactionCount: number
  // 顯示幣別;支出為正
  expense: number
  income: number
  expenseCategories: SummaryCategory[]
}

export type TripReport = {
  currency: string
  exponents: Record<string, number>
  // 依開始日期由新到舊
  trips: TripReportItem[]
  missingRate: number
}

// 總覽頁(預設頁):其他報表的縮小版,一次取回
export type Overview = {
  currency: string
  exponents: Record<string, number>
  // 用來切「本月」的日期(瀏覽器的今天)
  today: string
  thisMonth: { from: string; to: string; summary: TransactionSummary }
  lastMonth: { from: string; to: string; summary: TransactionSummary }
  netWorth: NetWorth
  // 含本月的過去 12 個月
  recent: MonthlyReport
  // 本月的固定支出:每月一次的項目全列(已扣 / 未扣),其他頻率的只列本月有扣的
  scheduled: ScheduledReportItem[]
  // 進行中的旅行(今天在日期範圍內);沒有就是最近開始的一趟;都沒有是 null
  trip: (TripReportItem & { ongoing: boolean }) | null
  uncategorized: number
  // 帳本最後一筆交易的日期(UTC);沒有交易是 null
  lastTransactionDate: string | null
}
