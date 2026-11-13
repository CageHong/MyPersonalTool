// 匯入結果的獨立驗證:直接比對 v2 的資料庫與新的資料庫。
//
//   tsx src/tools/verify-import.ts <v2 的 finance.db> <新的 finance.db> <import-v2.json> <匯入前的 finance.db>
//
// 不匯入 src/ 底下的任何程式(schema、匯入工具、正規化函式都不用),用自己的算法重算一次,
// 這樣匯入工具的錯不會同時出現在驗證裡。全部通過結束碼為 0,否則為 1。
import { existsSync, readFileSync } from 'node:fs'
import Database from 'better-sqlite3'

const [oldPath, newPath, configPath, previousPath] = process.argv.slice(2)
if (!oldPath || !newPath) {
  console.error('用法:verify-import.ts <v2 的 finance.db> <新的 finance.db> [import-v2.json] [匯入前的 finance.db]')
  process.exit(1)
}
const config: {
  payeeSuffixes?: string[]
  payeeMerges?: { into: string; from: string[] }[]
  accountGroups?: { name: string; accounts: string[] }[]
} = configPath && existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf-8')) : {}

const oldDb = new Database(oldPath, { readonly: true, fileMustExist: true })
const newDb = new Database(newPath, { readonly: true, fileMustExist: true })
type Row = Record<string, string | number | null>
const q = (db: Database.Database, query: string, ...params: unknown[]) => db.prepare(query).all(...params) as Row[]
const dump = (db: Database.Database, query: string) => JSON.stringify(q(db, query))

let failed = 0
function check(label: string, ok: boolean, detail = '') {
  if (!ok) failed += 1
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? `  ${detail}` : ''}`)
}

console.log('\n── 驗證 ──')

// 1. 帳本本身 ─────────────────────────────────────────────────────
const unbalanced = q(
  newDb,
  'SELECT transaction_id FROM finance_postings GROUP BY transaction_id, currency HAVING SUM(amount) <> 0',
)
check('每筆交易、每個幣別的分錄加總為零', unbalanced.length === 0, `不平 ${unbalanced.length} 筆`)
check('外鍵都指得到資料', q(newDb, 'PRAGMA foreign_key_check').length === 0)

// 2. 原樣搬過來的表 ───────────────────────────────────────────────
const sameAccounts =
  'SELECT id, name, type, subtype, parent_id, currency, color, sort_order, is_active, is_system, legacy_id, created_at FROM finance_accounts ORDER BY id'
check('帳戶(群組以外的欄位)', dump(oldDb, sameAccounts) === dump(newDb, sameAccounts), `${q(newDb, sameAccounts).length} 個`)
const samePostings =
  'SELECT id, transaction_id, account_id, amount, currency, memo, sort_order FROM finance_postings ORDER BY id'
check('分錄', dump(oldDb, samePostings) === dump(newDb, samePostings), `${q(newDb, samePostings).length} 條`)
const sameTx =
  'SELECT id, occurred_at, note, source, external_id, scheduled_id, category_source, created_at, updated_at FROM finance_transactions ORDER BY id'
check('交易(對象以外的欄位)', dump(oldDb, sameTx) === dump(newDb, sameTx), `${q(newDb, sameTx).length} 筆`)
const balances =
  'SELECT account_id, currency, SUM(amount) AS balance FROM finance_postings GROUP BY account_id, currency ORDER BY 1, 2'
check('每個帳戶、每個幣別的餘額', dump(oldDb, balances) === dump(newDb, balances))
const sameTags = 'SELECT id, name, color, starts_on, ends_on, created_at FROM finance_tags ORDER BY id'
const sameLinks = 'SELECT transaction_id, tag_id FROM finance_transaction_tags ORDER BY 1, 2'
check(
  '標籤與標記',
  dump(oldDb, sameTags) === dump(newDb, sameTags) && dump(oldDb, sameLinks) === dump(newDb, sameLinks),
  `${q(newDb, sameTags).length} 個標籤、${q(newDb, sameLinks).length} 次標記`,
)
check(
  '幣別',
  dump(oldDb, 'SELECT * FROM finance_currencies ORDER BY code') === dump(newDb, 'SELECT * FROM finance_currencies ORDER BY code'),
)
// 匯率不是從 v2 來的:要跟匯入前的資料庫一模一樣(第一次匯入時是空的)
const fxTables = [
  'SELECT date, currency, rate_to_eur, source, fetched_at FROM finance_fx_rates ORDER BY 1, 2',
  'SELECT date, base, quote, rate, source, fetched_at FROM finance_fx_direct_quotes ORDER BY 1, 2, 3',
]
if (previousPath && existsSync(previousPath)) {
  const previous = new Database(previousPath, { readonly: true, fileMustExist: true })
  check(
    '匯率與匯入前相同',
    fxTables.every((query) => dump(previous, query) === dump(newDb, query)),
    `${q(newDb, fxTables[0]).length} 筆`,
  )
  previous.close()
} else {
  check('匯率是空的(還沒有匯入前的資料庫)', fxTables.every((query) => q(newDb, query).length === 0))
}
const display = q(newDb, `SELECT value FROM finance_settings WHERE key = 'display_currency'`)[0]?.value
const base = q(oldDb, `SELECT value FROM finance_settings WHERE key = 'base_currency'`)[0]?.value
check('顯示幣別', display === base, String(display))

// 3. 收款人 ───────────────────────────────────────────────────────
// 自己的正規化:不去後綴、不合併;後綴與合併當成「允許併在一起的理由」另外檢查
const fold = (text: string) => text.toLowerCase().split(/\s+/).filter(Boolean).join(' ')
const suffixes = (config.payeeSuffixes ?? []).map(fold)
const withoutSuffix = (text: string) => {
  for (const suffix of suffixes) {
    if (text.endsWith(' ' + suffix)) return text.slice(0, -(suffix.length + 1))
  }
  return text
}
const mergedTo = new Map<string, string>()
for (const merge of config.payeeMerges ?? []) {
  for (const from of merge.from) mergedTo.set(withoutSuffix(fold(from)), withoutSuffix(fold(merge.into)))
}
const expectedKey = (raw: string) => {
  const key = withoutSuffix(fold(raw))
  return mergedTo.get(key) ?? key
}

const oldPayee = new Map(q(oldDb, 'SELECT id, payee FROM finance_transactions').map((r) => [r.id, r.payee as string | null]))
const newTx = q(newDb, 'SELECT id, payee_id, import_meta FROM finance_transactions')
const keyOfPayee = new Map<number, string>() // 收款人 id → 預期的鍵
const payeeOfKey = new Map<string, number>()
let payeeMismatch = 0
let metaMissing = 0
let missingPayee = 0
for (const r of newTx) {
  const raw = oldPayee.get(r.id) ?? null
  if (raw === null || raw.trim() === '') {
    if (r.payee_id !== null) payeeMismatch += 1
    continue
  }
  if (r.payee_id === null) {
    missingPayee += 1
    continue
  }
  const key = expectedKey(raw)
  const id = Number(r.payee_id)
  // 同一個鍵 ↔ 同一個收款人,兩個方向都要成立
  if ((keyOfPayee.get(id) ?? key) !== key || (payeeOfKey.get(key) ?? id) !== id) payeeMismatch += 1
  keyOfPayee.set(id, key)
  payeeOfKey.set(key, id)
  const meta = r.import_meta === null ? {} : JSON.parse(String(r.import_meta))
  if (typeof meta.payee_original !== 'string') metaMissing += 1
}
check('有對象的交易都有收款人', missingPayee === 0, missingPayee ? `缺 ${missingPayee} 筆` : '')
check(
  '同一個對象 ↔ 同一個收款人(只有後綴與設定的合併會併在一起)',
  payeeMismatch === 0,
  payeeMismatch ? `不符 ${payeeMismatch} 筆` : `${new Set(oldPayee.values()).size} 種寫法 → ${keyOfPayee.size} 個收款人`,
)
check('原始的對象文字留在 import_meta', metaMissing === 0, metaMissing ? `缺 ${metaMissing} 筆` : '')
const payeeCount = Number(q(newDb, 'SELECT COUNT(*) AS n FROM finance_payees')[0].n)
check('沒有用不到的收款人', payeeCount === keyOfPayee.size, `${payeeCount} 個`)
const aliases = q(newDb, 'SELECT alias, payee_id FROM finance_payee_aliases')
const aliasOk = [...oldPayee.values()].every((raw) => {
  if (raw === null || raw.trim() === '') return true
  const want = payeeOfKey.get(expectedKey(raw))
  return aliases.some((a) => a.payee_id === want && a.alias === withoutSuffix(fold(raw)))
})
check('每種寫法都有一條別名指到它的收款人', aliasOk, `${aliases.length} 條`)
// payeeMerges 的每一種寫法(v2 的資料裡沒出現過的也算)都有別名,指到 into 那個寫法的收款人
const aliasTarget = new Map(aliases.map((a) => [String(a.alias), a.payee_id]))
const mergeAliasOk = (config.payeeMerges ?? []).every((merge) => {
  const target = aliasTarget.get(withoutSuffix(fold(merge.into)))
  return (
    target !== undefined &&
    merge.from.every((from) => aliasTarget.get(withoutSuffix(fold(from))) === target)
  )
})
check(
  'payeeMerges 的每一種寫法都有別名指到 into 的收款人',
  mergeAliasOk,
  `${(config.payeeMerges ?? []).reduce((n, m) => n + m.from.length, 0)} 種寫法`,
)

// 4. 週期項目 ─────────────────────────────────────────────────────
const sameScheduled =
  'SELECT id, name, account_id, amount_min, amount_max, currency, frequency, interval, starts_on, ends_on, note, is_active, created_at FROM finance_scheduled_transactions ORDER BY id'
check('週期項目(比對對象以外的欄位)', dump(oldDb, sameScheduled) === dump(newDb, sameScheduled), `${q(newDb, sameScheduled).length} 項`)
const strayLinks = q(
  newDb,
  `SELECT t.id FROM finance_transactions t JOIN finance_scheduled_transactions s ON s.id = t.scheduled_id
   WHERE t.payee_id IS NOT s.payee_id`,
)
check('配對到週期項目的交易,收款人就是該項目的收款人', strayLinks.length === 0, strayLinks.length ? `不符 ${strayLinks.length} 筆` : '')

// 5. 規則 ─────────────────────────────────────────────────────────
const oldCategoryRules = `SELECT match_value, assign_account_id, assign_tags, priority, is_active FROM finance_rules WHERE match_field = 'source_category' ORDER BY 1`
check('來源分類規則', dump(oldDb, oldCategoryRules) === dump(newDb, oldCategoryRules), `${q(newDb, oldCategoryRules).length} 條`)
// 舊的對象規則用 SQL 的 LIKE 重算它會命中哪些交易,這些交易的收款人都要有對應的新規則
const likePattern: Record<string, (v: string) => string> = {
  contains: (v) => `%${v}%`,
  equals: (v) => v,
  starts_with: (v) => `${v}%`,
}
const newPayeeRules = new Set(
  q(newDb, `SELECT payee_id, assign_account_id FROM finance_rules WHERE match_field = 'payee'`).map(
    (r) => `${r.payee_id}|${r.assign_account_id}`,
  ),
)
const wanted = new Set<string>()
const unused: string[] = []
for (const rule of q(oldDb, `SELECT * FROM finance_rules WHERE match_field = 'payee'`)) {
  const hits = q(
    oldDb,
    'SELECT DISTINCT id FROM finance_transactions WHERE lower(payee) LIKE lower(?)',
    likePattern[String(rule.match_operator)](String(rule.match_value)),
  )
  if (!hits.length) unused.push(String(rule.match_value))
  const txPayee = new Map(newTx.map((r) => [r.id, r.payee_id]))
  for (const hit of hits) wanted.add(`${txPayee.get(hit.id)}|${rule.assign_account_id}`)
}
const missingRules = [...wanted].filter((key) => !newPayeeRules.has(key))
const extraRules = [...newPayeeRules].filter((key) => !wanted.has(key))
check(
  '對象規則:舊規則命中的每個收款人都有一條新規則,沒有多出來的',
  missingRules.length === 0 && extraRules.length === 0,
  `${newPayeeRules.size} 條` + (unused.length ? `;舊規則沒有命中任何交易而略過:${unused.join('、')}` : ''),
)

// 6. 帳戶群組 ─────────────────────────────────────────────────────
const groupWant = new Map<string, string>()
for (const group of config.accountGroups ?? []) for (const name of group.accounts) groupWant.set(name, group.name)
const groupRows = q(
  newDb,
  `SELECT a.name, a.type, g.name AS group_name FROM finance_accounts a LEFT JOIN finance_account_groups g ON g.id = a.group_id`,
)
const groupOk = groupRows.every((r) =>
  r.type === 'asset' || r.type === 'liability'
    ? (groupWant.get(String(r.name)) ?? null) === r.group_name
    : r.group_name === null,
)
check('帳戶群組與設定一致', groupOk, `${(config.accountGroups ?? []).length} 個群組、${groupWant.size} 個帳戶`)

console.log(failed ? `\n${failed} 項沒有通過` : '\n全部通過')
process.exit(failed ? 1 : 0)
