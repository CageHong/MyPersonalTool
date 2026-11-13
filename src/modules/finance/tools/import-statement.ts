// 匯入對帳單(目前支援 Wise 的交易紀錄 CSV)。
//
//   npm run finance:import-statement -- <檔案> [<檔案> …]            試跑:只印報告,資料庫不變
//   npm run finance:import-statement -- <檔案> [<檔案> …] --apply    套用:新增帳本沒有的交易、補入帳交易的對象
//
// 可以一次給多個檔案(分段匯出、期間重疊都可以):同一個 ID 只算一次;同一個 ID 內容不同時列為衝突,不能套用。
//
// 已經在帳本裡的交易(用來源的 ID 判斷)不會被覆蓋:只有「入帳、對象是帳戶持有人自己」的會換成匯款人;
// 金額跟帳本不同的只列在報告裡。同一份檔案可以重複套用。
// 套用前會把資料庫複製一份到 finance.db.before-import(每次覆蓋)。
// 對象的後綴清單沿用 <資料夾>/finance/import-v2.json 的 payeeSuffixes,跟從 v2 匯入時用同一份;
// 同一個對象的不同寫法(payeeMerges)由 finance:import-v2 寫進別名表,這裡經過別名表對到收款人。
import { copyFileSync, existsSync, readFileSync } from 'node:fs'
import { sql } from 'drizzle-orm'
import { parseStatement, StatementFormatError } from '@personal-tools/statement-parsers'
import type { PendingTransaction } from '@personal-tools/statement-parsers'
import { toolDataPath } from '../../../platform/dataDir'
import { openDb } from '../db/index'
import { DB_PATH } from '../db/path'
import { applyImport, mergeParseResults, planImport } from '../server/import/index'
import type { AccountAmount, PlanItem } from '../server/import/index'
import { getAccountBalances } from '../server/ledger/balances'

const LIST_LIMIT = 40

function fail(message: string): never {
  console.error(`✗ ${message}`)
  process.exit(1)
}

function section<T>(title: string, rows: T[], line: (row: T) => string) {
  if (!rows.length) return
  console.log(`\n── ${title}(${rows.length})──`)
  for (const row of rows.slice(0, LIST_LIMIT)) console.log(`  ${line(row)}`)
  if (rows.length > LIST_LIMIT) console.log(`  …還有 ${rows.length - LIST_LIMIT} 筆`)
}

function main() {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const files = args.filter((arg) => !arg.startsWith('--'))
  if (!files.length) fail('要指定對帳單檔案:npm run finance:import-statement -- <檔案> [<檔案> …] [--apply]')
  for (const file of files) if (!existsSync(file)) fail(`找不到 ${file}`)
  if (!existsSync(DB_PATH)) fail(`找不到資料庫 ${DB_PATH}`)

  const results = files.map((file) => {
    try {
      const result = parseStatement(readFileSync(file, 'utf-8'))
      if (!result) fail(`${file}:認不出這個檔案的來源(目前支援:Wise 交易紀錄 CSV)`)
      return result
    } catch (error) {
      if (error instanceof StatementFormatError) fail(`${file}:${error.message}`)
      throw error
    }
  })
  let merged
  try {
    merged = mergeParseResults(results)
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
  }
  const { merged: parsed, conflicts } = merged

  const configPath = toolDataPath('finance', 'import-v2.json')
  const config: { payeeSuffixes?: string[] } = existsSync(configPath)
    ? JSON.parse(readFileSync(configPath, 'utf-8'))
    : {}
  const options = { payeeSuffixes: config.payeeSuffixes ?? [] }

  const db = openDb(DB_PATH)
  const plan = planImport(db, parsed, options)

  // 顯示用:帳戶名稱、幣別的小數位數
  const accountNames = new Map(
    db
      .all<{ id: number; name: string }>(sql`SELECT id, name FROM finance_accounts`)
      .map((row) => [row.id, row.name]),
  )
  const exponents = new Map(
    db
      .all<{ code: string; exponent: number }>(sql`SELECT code, exponent FROM finance_currencies`)
      .map((row) => [row.code, row.exponent]),
  )
  const money = (amount: number, currency: string) => {
    const exponent = exponents.get(currency) ?? 0
    return `${(amount / 10 ** exponent).toFixed(exponent)} ${currency}`
  }
  const amounts = (rows: AccountAmount[]) =>
    rows.map((row) => `${accountNames.get(row.accountId)} ${money(row.amount, row.currency)}`).join('、') ||
    '(沒有)'
  const head = (pending: PendingTransaction) =>
    `${pending.occurredAt.slice(0, 10)}  ${pending.externalId}`

  const fresh = plan.items.filter((item) => item.status === 'new')
  const existing = plan.items.filter(
    (item): item is Extract<PlanItem, { status: 'existing' }> => item.status === 'existing',
  )
  const payeeFixes = existing.filter((item) => item.payeeFix)
  const amountDiffs = existing.filter((item) => item.amountDiff)
  const incomingKept = existing.filter((item) => item.pending.kind === 'in' && !item.payeeFix)

  files.forEach((file, index) =>
    console.log(`檔案 ${index + 1}:${file}(${results[index].transactions.length} 筆)`),
  )
  console.log(`來源:${plan.source}`)
  console.log(
    `合計 ${parsed.transactions.length} 筆交易(重複的 ID 只算一次),略過 ${plan.skipped.length} 列`,
  )
  console.log(`  新的:${fresh.length}`)
  console.log(
    `  已經在帳本裡:${existing.length}(要補對象 ${payeeFixes.length}、金額不同 ${amountDiffs.length})`,
  )
  console.log(`  入帳、對象不用補:${incomingKept.length}`)
  console.log(`  帳本有、檔案沒有:${plan.missingFromFile}`)
  console.log(`  無法處理:${plan.errors.length}`)
  if (files.length > 1) console.log(`  檔案之間同一個 ID 內容不同:${conflicts.length}`)

  const skipCounts = new Map<string, number>()
  for (const row of plan.skipped) {
    const key = `${row.reason}${row.detail ? `(${row.detail})` : ''}`
    skipCounts.set(key, (skipCounts.get(key) ?? 0) + 1)
  }
  section('略過的列,依原因', [...skipCounts], ([key, count]) => `${key}:${count}`)
  section(
    '檔案之間同一個 ID 內容不同(兩筆都不匯入)',
    conflicts,
    (c) => `${c.externalId}  ${c.lines.map((l) => `檔案 ${l.file + 1} 第 ${l.line} 行`).join('、')}`,
  )
  section('無法處理', plan.errors, (e) => `第 ${e.line} 行  ${e.externalId ?? ''}  ${e.message}`)
  section(
    '要補對象',
    payeeFixes,
    (item) => `${head(item.pending)}  ${item.payeeFix!.from} → ${item.payeeFix!.to}`,
  )
  section(
    '金額不同(不會自動改)',
    amountDiffs,
    (item) =>
      `${head(item.pending)}  帳本:${amounts(item.amountDiff!.existing)}  檔案:${amounts(item.amountDiff!.incoming)}`,
  )
  // Wise 的入帳列有時帶 Target fee;金額欄已經是扣掉之後的數字,這裡列出來供人工確認
  section(
    'Target fee 不為零',
    parsed.transactions.filter((tx) => /[1-9]/.test(tx.raw['Target fee amount'] ?? '')),
    (tx) => `${head(tx)}  ${tx.raw['Target fee amount']} ${tx.raw['Target fee currency'] ?? ''}`,
  )
  section('新的', fresh, (item) => {
    const moved = item.pending.movements.map((m) => `${m.amount} ${m.currency}`).join(' / ')
    return `${head(item.pending)}  ${moved}  ${item.pending.counterparty ?? ''}`
  })

  if (!apply) {
    console.log('\n試跑結束,資料庫沒有變。確認報告後加上 --apply 套用。')
    return
  }
  if (plan.errors.length) fail('有無法處理的列,沒有套用')
  if (conflicts.length) fail('檔案之間有內容不同的同一個 ID,沒有套用')

  const backupPath = `${DB_PATH}.before-import`
  db.run(sql`PRAGMA wal_checkpoint(TRUNCATE)`)
  copyFileSync(DB_PATH, backupPath)
  const outcome = applyImport(db, plan, options)
  const unbalanced = db.all(sql`SELECT * FROM finance_v_unbalanced`)
  if (unbalanced.length) fail(`套用後有 ${unbalanced.length} 筆交易借貸不平;用 ${backupPath} 還原`)

  console.log(`\n✓ 已套用:新增 ${outcome.created} 筆,補對象 ${outcome.payeesFixed} 筆`)
  console.log(`  套用前的備份:${backupPath}`)
  const touched = new Set(
    plan.items.flatMap((item) =>
      item.status === 'new' ? item.draft.postings.map((posting) => posting.accountId) : [],
    ),
  )
  for (const balance of getAccountBalances(db)) {
    if (touched.has(balance.accountId)) {
      console.log(
        `  ${accountNames.get(balance.accountId)} 的餘額:${money(balance.amount, balance.currency)}`,
      )
    }
  }
}

main()
