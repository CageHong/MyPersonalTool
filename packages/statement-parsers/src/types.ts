// 「待匯入交易」:每個來源的解析器都輸出這個型別,使用端只認這一種。
// 這裡不知道帳本的帳戶 id、收款人 id、幣別的小數位數;對應與換算都由使用端做。

export type StatementSource = 'wise_csv'

// 一個來源帳戶的金額變動。
// account:來源自己的帳戶代號(例:'wise:EUR'),不是帳本的帳戶。
// amount:十進位字串,正 = 流入該帳戶、負 = 流出;不含手續費。
export interface PendingMovement {
  account: string
  currency: string
  amount: string
}

// 手續費:在 movements 之外,另外從 account 扣掉的金額。amount 是正的十進位字串。
export interface PendingFee {
  account: string
  currency: string
  amount: string
}

// out:付出去;in:收進來;exchange:同一個來源內兩個幣別互換(movements 有兩筆,先流出、後流入)
export type PendingKind = 'out' | 'in' | 'exchange'

export interface PendingTransaction {
  source: StatementSource
  // 來源給的交易 ID;來源沒有 ID 時是 null
  externalId: string | null
  // UTC 的 ISO 8601,格式固定為 YYYY-MM-DDTHH:MM:SS+00:00
  occurredAt: string
  kind: PendingKind
  movements: PendingMovement[]
  fee: PendingFee | null
  // 對方的名稱:out 是收款人,in 是匯款人;exchange 沒有對方
  counterparty: string | null
  reference: string | null
  // 來源自己給的分類(原文)
  sourceCategory: string | null
  // 第幾行(從 1 算,欄位名那一行是 1)
  line: number
  // 這一列的所有原始欄位,原樣保留
  raw: Record<string, string>
}

export type SkipReason =
  | 'malformed_row' // 欄位數跟欄位名那一行不一樣
  | 'status' // 狀態不是已完成(取消、處理中、退款的付出方等)
  | 'missing_id'
  | 'unknown_direction'
  | 'invalid_amount' // 金額不是十進位數字,或不大於零
  | 'invalid_date'

export interface SkippedRow {
  line: number
  reason: SkipReason
  // 造成略過的原始值(例:狀態的原文)
  detail: string
  raw: Record<string, string>
}

export interface ParseResult {
  source: StatementSource
  transactions: PendingTransaction[]
  skipped: SkippedRow[]
}

// 整份檔案無法解析(不是個別列的問題)
export class StatementFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StatementFormatError'
  }
}
