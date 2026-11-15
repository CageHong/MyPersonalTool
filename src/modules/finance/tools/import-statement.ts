// 匯入對帳單(目前支援 Wise 的交易紀錄 CSV)。
//
//   npm run finance:import-statement -- <檔案> [<檔案> …]            試跑:只印報告,資料庫不變
//   npm run finance:import-statement -- <檔案> [<檔案> …] --apply    套用:新增帳本沒有的交易、補入帳交易的對象
//
// 可以一次給多個檔案(分段匯出、期間重疊都可以):同一個 ID 只算一次;同一個 ID 內容不同時列為衝突,不能套用。
//
// 已經在帳本裡的交易(用來源的 ID 判斷)不會被覆蓋:只有「入帳、對象是帳戶持有人自己」的會換成匯款人;
// 金額跟帳本不同的只列在報告裡。同一份檔案可以重複套用。
// 套用前會把資料庫備份到 finance.db.before-import(每次覆蓋)。
// 解析、合併、計畫、摘要、套用都在 server/import/prepare.ts,跟畫面(/finance/import)用同一套。
import { existsSync, readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { sql } from 'drizzle-orm'
import { formatMoney } from '../lib/money'
import type { AccountMoney } from '../lib/import-summary'
import { openDb } from '../db/index'
import { BACKUP_BEFORE_IMPORT_PATH, DB_PATH } from '../db/path'
import { loadImportOptions } from '../server/import/options'
import { applyStatementFiles, prepareImport, summarizeImport } from '../server/import/prepare'
import { ValidationError } from '../server/errors'
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
  const paths = args.filter((arg) => !arg.startsWith('--'))
  if (!paths.length) fail('要指定對帳單檔案:npm run finance:import-statement -- <檔案> [<檔案> …] [--apply]')
  for (const path of paths) if (!existsSync(path)) fail(`找不到 ${path}`)
  if (!existsSync(DB_PATH)) fail(`找不到資料庫 ${DB_PATH}`)

  const files = paths.map((path) => ({ name: basename(path), text: readFileSync(path, 'utf-8') }))
  const options = loadImportOptions()
  const db = openDb(DB_PATH)
  let summary
  try {
    summary = summarizeImport(db, prepareImport(db, files, options))
  } catch (error) {
    if (error instanceof ValidationError) fail(error.message)
    throw error
  }

  const { counts, classification: c, exponents } = summary
  const money = (amount: number, currency: string) => formatMoney(amount, currency, exponents)
  const amounts = (rows: AccountMoney[]) =>
    rows.map((row) => `${row.account} ${money(row.amount, row.currency)}`).join('、') || '(沒有)'
  const head = (row: { occurredAt: string; externalId: string }) =>
    `${row.occurredAt.slice(0, 10)}  ${row.externalId}`
  const where = (lines: { file: number; line: number }[]) =>
    lines.map((l) => `檔案 ${l.file + 1} 第 ${l.line} 行`).join('、')

  paths.forEach((path, index) =>
    console.log(`檔案 ${index + 1}:${path}(${summary.files[index].transactions} 筆)`),
  )
  console.log(`來源:${summary.source}`)
  console.log(`合計 ${counts.transactions} 筆交易(重複的 ID 只算一次),略過 ${counts.skipped} 列`)
  console.log(`  新的:${counts.new}`)
  console.log(
    `    分類(換匯除外 ${counts.new - c.exchange} 筆):週期項目 ${c.scheduled}、對象規則 ${c.rule}、` +
      `對象歷史 ${c.payeeHistory}、來源分類 ${c.sourceCategory}、未分類 ${c.unclassified}`,
  )
  console.log(
    `  已經在帳本裡:${counts.existing}(要補對象 ${counts.payeeFixes}、金額不同 ${counts.amountDiffs})`,
  )
  console.log(`  入帳、對象不用補:${counts.incomingKept}`)
  console.log(`  帳本有、檔案沒有:${counts.missingFromFile}`)
  console.log(`  刪掉過、不再加回來:${counts.deleted}`)
  console.log(`  無法處理:${counts.errors}`)
  console.log(`  檔案之間同一個 ID 內容不同:${counts.conflicts}`)
  console.log(`  檔案之間同一個 ID 只有備註或來源分類不同(用第一份):${counts.detailDiffs}`)

  section('略過的列,依原因', summary.skipped, (row) => `${row.reason}:${row.count}`)
  section('檔案之間同一個 ID 內容不同(兩筆都不匯入)', summary.conflicts, (row) => `${row.externalId}  ${where(row.lines)}`)
  section('檔案之間同一個 ID 只有備註或來源分類不同(用第一份的)', summary.detailDiffs, (row) => `${row.externalId}  ${where(row.lines)}`)
  section('無法處理', summary.errors, (e) => `第 ${e.line} 行  ${e.externalId ?? ''}  ${e.message}`)
  section('要補對象', summary.payeeFixes, (row) => `${head(row)}  ${row.from} → ${row.to}`)
  section(
    '金額不同(不會自動改)',
    summary.amountDiffs,
    (row) => `${head(row)}  帳本:${amounts(row.existing)}  檔案:${amounts(row.incoming)}`,
  )
  section('Target fee 不為零', summary.targetFees, (row) => `${head(row)}  ${row.amount} ${row.currency}`)
  section(
    '週期項目同時符合兩個以上(沒有配對)',
    summary.ambiguousScheduled,
    (row) => `${head(row)}  項目 id:${row.scheduledIds.join('、')}`,
  )
  section('新的', summary.newItems, (row) => {
    const category =
      row.kind === 'exchange' ? '換匯' : row.category === null ? '未分類' : `${row.category}(${row.categorySource})`
    return `${head(row)}  ${amounts(row.source)}  ${row.payee ?? ''}  → ${category}`
  })

  if (!apply) {
    console.log('\n試跑結束,資料庫沒有變。確認報告後加上 --apply 套用。')
    return
  }
  if (counts.errors) fail('有無法處理的列,沒有套用')
  if (counts.conflicts) fail('檔案之間有內容不同的同一個 ID,沒有套用')

  const outcome = applyStatementFiles(db, files, options, {
    fingerprint: summary.fingerprint,
    backupPath: BACKUP_BEFORE_IMPORT_PATH,
  })
  const unbalanced = db.all(sql`SELECT * FROM finance_v_unbalanced`)
  if (unbalanced.length) {
    fail(`套用後有 ${unbalanced.length} 筆交易借貸不平;用 ${BACKUP_BEFORE_IMPORT_PATH} 還原`)
  }

  console.log(`\n✓ 已套用:新增 ${outcome.created} 筆,補對象 ${outcome.payeesFixed} 筆`)
  console.log(`  套用前的備份:${outcome.backupPath}`)
  const touched = new Set(summary.newItems.flatMap((row) => row.source.map((s) => s.account)))
  const names = new Map(
    db.all<{ id: number; name: string }>(sql`SELECT id, name FROM finance_accounts`).map((r) => [r.id, r.name]),
  )
  for (const balance of getAccountBalances(db)) {
    const name = names.get(balance.accountId) ?? ''
    if (touched.has(name)) console.log(`  ${name} 的餘額:${money(balance.amount, balance.currency)}`)
  }
}

main()
