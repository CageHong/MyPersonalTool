// fx:匯率的查詢、換算、更新。只用於顯示與報表;換匯實際的金額記在交易的分錄裡,不受這裡影響。
//
// 這個模組之後可能搬到平台層共用,所以不匯入 finance 其他模組的程式,
// 也不讀匯率以外的表(要更新哪些幣別、從哪一天開始,由呼叫的人傳進來)。
import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm'
import type { FinanceDb } from '../../db/index'
import { financeFxDirectQuotes, financeFxRates } from '../../db/schema'
import type { SourceRate } from './frankfurter'

// 內部換算的基準。跟顯示幣別無關,不能設定
const BASE = 'EUR'

export class FxRateMissingError extends Error {
  constructor(
    public readonly currency: string,
    public readonly date: string,
  ) {
    super(`沒有 ${currency} 的匯率(${date})`)
  }
}

// 1 單位 currency = ? 歐元。取 date 當天或之前最近的一筆;之前完全沒有資料時取最早的一筆
function rateToEur(db: FinanceDb, currency: string, date: string): number {
  if (currency === BASE) return 1
  const before = db
    .select({ rate: financeFxRates.rateToEur })
    .from(financeFxRates)
    .where(and(eq(financeFxRates.currency, currency), lte(financeFxRates.date, date)))
    .orderBy(desc(financeFxRates.date))
    .limit(1)
    .get()
  if (before) return before.rate
  const earliest = db
    .select({ rate: financeFxRates.rateToEur })
    .from(financeFxRates)
    .where(eq(financeFxRates.currency, currency))
    .orderBy(asc(financeFxRates.date))
    .limit(1)
    .get()
  if (earliest) return earliest.rate
  throw new FxRateMissingError(currency, date)
}

// 1 單位 from = ? 單位 to。順序:相同幣別 → 當天的直接報價(或它的反方向)→ 經過歐元換算。
// 直接報價只用當天的:較新的資料優先於較直接的報價
export function getRate(db: FinanceDb, from: string, to: string, date: string): number {
  if (from === to) return 1
  const [base, quote] = from < to ? [from, to] : [to, from]
  const direct = db
    .select({ rate: financeFxDirectQuotes.rate })
    .from(financeFxDirectQuotes)
    .where(
      and(
        eq(financeFxDirectQuotes.date, date),
        eq(financeFxDirectQuotes.base, base),
        eq(financeFxDirectQuotes.quote, quote),
      ),
    )
    .get()
  if (direct) return from === base ? direct.rate : 1 / direct.rate
  return rateToEur(db, from, date) / rateToEur(db, to, date)
}

// 把最小貨幣單位的金額換成另一個幣別的最小貨幣單位。結果不取整數:
// 多筆金額要先加總再取整數,否則每筆的捨入誤差會累積
export function convert(
  db: FinanceDb,
  amount: number,
  from: { currency: string; exponent: number },
  to: { currency: string; exponent: number },
  date: string,
): number {
  return amount * getRate(db, from.currency, to.currency, date) * 10 ** (to.exponent - from.exponent)
}

// 資料庫裡某個來源最新的一天;沒有資料回傳 null
export function latestRateDate(db: FinanceDb, source: string): string | null {
  const row = db
    .select({ date: sql<string | null>`MAX(${financeFxRates.date})` })
    .from(financeFxRates)
    .where(eq(financeFxRates.source, source))
    .get()
  return row?.date ?? null
}

// 寫入抓回來的匯率。同一天同一個幣別已經有資料就覆蓋。
// replaceAll:先清掉整張表(換來源時用,讓整張表只有一個來源);清除與寫入在同一個 DB transaction
export function storeRates(
  db: FinanceDb,
  rates: readonly SourceRate[],
  options: { source: string; fetchedAt: string; replaceAll?: boolean },
): number {
  db.transaction((tx) => {
    if (options.replaceAll) tx.delete(financeFxRates).run()
    for (const rate of rates) {
      if (rate.currency === BASE) continue
      tx.insert(financeFxRates)
        .values({ ...rate, source: options.source, fetchedAt: options.fetchedAt })
        .onConflictDoUpdate({
          target: [financeFxRates.date, financeFxRates.currency],
          set: { rateToEur: rate.rateToEur, source: options.source, fetchedAt: options.fetchedAt },
        })
        .run()
    }
  })
  return rates.filter((rate) => rate.currency !== BASE).length
}

// 檢查某段期間每個幣別有幾天的資料(更新後回報用)
export function rateCoverage(db: FinanceDb, from: string) {
  return db
    .select({
      currency: financeFxRates.currency,
      days: sql<number>`COUNT(*)`,
      first: sql<string>`MIN(${financeFxRates.date})`,
      last: sql<string>`MAX(${financeFxRates.date})`,
    })
    .from(financeFxRates)
    .where(gte(financeFxRates.date, from))
    .groupBy(financeFxRates.currency)
    .orderBy(financeFxRates.currency)
    .all()
}
