// 更新匯率表。
//
//   npm run finance:fx-update            從資料庫裡最新的一天接著抓到今天
//   npm run finance:fx-update -- --all   清掉整張表,從最早的交易往前 7 天開始全部重抓
//
// 要抓哪些幣別(幣別表裡歐元以外的全部)、從哪一天開始,在這裡決定後傳給 fx 模組。
import { sql } from 'drizzle-orm'
import { openDb } from '../db/index'
import { DB_PATH } from '../db/path'
import { FRANKFURTER_SOURCE, fetchFrankfurterRates } from '../server/fx/frankfurter'
import { latestRateDate, rateCoverage, storeRates } from '../server/fx/index'

function shiftDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

async function main() {
  const all = process.argv.includes('--all')
  const db = openDb(DB_PATH)
  const currencies = db
    .all<{ code: string }>(sql`SELECT code FROM finance_currencies WHERE code <> 'EUR' ORDER BY code`)
    .map((row) => row.code)
  const firstTx = db.all<{ date: string | null }>(
    sql`SELECT MIN(substr(occurred_at, 1, 10)) AS date FROM finance_transactions`,
  )[0].date
  if (!currencies.length || !firstTx) {
    console.error('✗ 資料庫裡沒有幣別或交易;先跑 npm run finance:import-v2')
    process.exit(1)
  }
  // 往前多抓 7 天:最早的交易如果落在來源沒有資料的日子,還是找得到之前最近的一筆
  const start = shiftDays(firstTx, -7)
  const latest = latestRateDate(db, FRANKFURTER_SOURCE)
  const from = all || latest === null ? start : latest

  console.log(`抓 ${currencies.join('、')},從 ${from} 到最新一天…`)
  const rates = await fetchFrankfurterRates({ currencies, from }, (url) => fetch(url))
  const missing = currencies.filter((code) => !rates.some((rate) => rate.currency === code))
  if (missing.length) {
    console.error(`✗ 來源沒有回傳這些幣別:${missing.join('、')};資料庫沒有更新`)
    process.exit(1)
  }
  const written = storeRates(db, rates, {
    source: FRANKFURTER_SOURCE,
    fetchedAt: new Date().toISOString(),
    // 第一次改用這個來源時,舊來源的資料一起清掉,整張表只留一個來源
    replaceAll: all || latest === null,
  })
  console.log(`✓ 寫入 ${written} 筆`)
  for (const row of rateCoverage(db, start)) {
    console.log(`  ${row.currency}:${row.days} 天(${row.first} ~ ${row.last})`)
  }
}

main().catch((error) => {
  console.error(`✗ ${error instanceof Error ? error.message : error}`)
  process.exit(1)
})
