// 匯入計畫給人看的摘要:API 回給畫面、命令列印出來的都是這個形狀。
// 放在 lib/:前端不能匯入 server/ 的型別。金額一律是最小貨幣單位的整數(正 = 借、負 = 貸),
// 顯示時用 exponents 換算(lib/money.ts)。

export type AccountMoney = { account: string; currency: string; amount: number }

export type FileLine = { file: number; line: number }

export type ImportSummary = {
  source: string
  // 會被寫入的內容的雜湊。套用時要帶回來;伺服器重算後不同就不套用(帳本在試跑之後變了)
  fingerprint: string
  // 沒有無法處理的列、沒有衝突,而且有東西要寫
  canApply: boolean
  files: { name: string; transactions: number }[]
  counts: {
    // 合併後的交易筆數(重複的 ID 只算一次)
    transactions: number
    skipped: number
    new: number
    existing: number
    payeeFixes: number
    amountDiffs: number
    // 入帳、已經在帳本裡、對象不用補
    incomingKept: number
    missingFromFile: number
    errors: number
    conflicts: number
    detailDiffs: number
  }
  // 新交易的分類來源(換匯不分類,另外算)
  classification: {
    scheduled: number
    rule: number
    payeeHistory: number
    sourceCategory: number
    unclassified: number
    exchange: number
  }
  // 幣別 → 小數位數
  exponents: Record<string, number>
  skipped: { reason: string; count: number }[]
  conflicts: { externalId: string; lines: FileLine[] }[]
  detailDiffs: { externalId: string; lines: FileLine[] }[]
  errors: { line: number; externalId: string | null; message: string }[]
  payeeFixes: { externalId: string; occurredAt: string; from: string; to: string }[]
  amountDiffs: {
    externalId: string
    occurredAt: string
    existing: AccountMoney[]
    incoming: AccountMoney[]
  }[]
  // Wise 的入帳列有時帶 Target fee;金額欄已經是扣掉之後的數字,列出來供人工確認。原文的十進位字串
  targetFees: { externalId: string; occurredAt: string; amount: string; currency: string }[]
  ambiguousScheduled: { externalId: string; occurredAt: string; scheduledIds: number[] }[]
  newItems: {
    externalId: string
    occurredAt: string
    kind: 'out' | 'in' | 'exchange'
    payee: string | null
    note: string | null
    // 來源那一側(例:Wise 的帳戶)的分錄
    source: AccountMoney[]
    // 決定的分類帳戶名稱(子分類是「上層 › 子分類」);未分類、換匯是 null
    category: string | null
    categorySource: 'scheduled' | 'rule' | 'payee_history' | 'source_category' | null
  }[]
}

export type ImportResult = {
  created: number
  payeesFixed: number
  // 套用前的備份;沒有備份是 null
  backupPath: string | null
}
