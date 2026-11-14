// 一次性工具:把 PACR v2 管線的產物(它的 finance.db)匯入這裡的資料庫。
//
//   PACR_DATA_DIR=<v2 的資料夾> npm run finance:import-v2
//   npm run finance:import-v2 -- <v2 的 finance.db>
//
// v2 的資料庫只會被讀取。每次都從空的資料庫重建:先建在暫存位置,驗證(verify-import.ts)通過才覆蓋
// 這裡的資料庫,所以可以重複執行。設定檔是 <資料夾>/finance/import-v2.json(範例在 config.example/)。
// 跟 v2 的差別:對象從文字變成收款人 + 別名;規則與週期項目改用收款人比對;帳戶群組;
// 預算表不帶過來。帳戶、交易、分錄、標籤、週期項目的 id 維持不變。
// 匯率不從 v2 帶:沿用目前資料庫裡的匯率(來源已經換了,由 finance:fx-update 維護)。
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import Database from 'better-sqlite3'
import { sql } from 'drizzle-orm'
import { applyMigrations, openDb } from '../db/index'
import { toolDataPath } from '../../../platform/dataDir'
import { DB_PATH } from '../db/path'
import * as t from '../db/schema'
import { normalizePayeeText, payeeDisplayName } from '../server/ledger/payees'

// v2 的資料庫在 PACR 自己的資料夾,不在平台的資料夾裡:從參數或 PACR_DATA_DIR 取得
const V2_DB_PATH =
  process.argv[2] ?? (process.env.PACR_DATA_DIR ? join(process.env.PACR_DATA_DIR, 'finance.db') : '')
const CONFIG_PATH = toolDataPath('finance', 'import-v2.json')

type Config = {
  payeeSuffixes?: string[]
  payeeMerges?: { into: string; from: string[] }[]
  accountGroups?: { name: string; accounts: string[] }[]
}

type Row = Record<string, string | number | null>

function fail(message: string): never {
  console.error(`✗ ${message}`)
  process.exit(1)
}

function main() {
  if (!V2_DB_PATH) fail('要指定 v2 的資料庫:設定 PACR_DATA_DIR,或把 finance.db 的路徑當成參數')
  if (!existsSync(V2_DB_PATH)) fail(`找不到 ${V2_DB_PATH};先跑 v2/build.py`)
  const config: Config = existsSync(CONFIG_PATH) ? JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) : {}
  const suffixes = config.payeeSuffixes ?? []
  const norm = (raw: string) => normalizePayeeText(raw, suffixes)

  const old = new Database(V2_DB_PATH, { readonly: true, fileMustExist: true })
  const rows = (query: string) => old.prepare(query).all() as Row[]
  const now = new Date().toISOString()
  const stats: Record<string, number | string> = {}

  const tmpPath = join(mkdtempSync(join(tmpdir(), 'pacr-finance-')), 'finance.db')
  const db = openDb(tmpPath)
  applyMigrations(db)

  db.transaction((tx) => {
    // ── 設定、幣別 ──────────────────────────────────────────────
    const base = rows(`SELECT value FROM finance_settings WHERE key = 'base_currency'`)[0]
    tx.insert(t.financeSettings).values({ key: 'display_currency', value: String(base.value) }).run()
    for (const r of rows('SELECT * FROM finance_currencies')) {
      tx.insert(t.financeCurrencies)
        .values({ code: String(r.code), exponent: Number(r.exponent), name: String(r.name) })
        .run()
    }

    // ── 帳戶群組、帳戶 ──────────────────────────────────────────
    const accounts = rows('SELECT * FROM finance_accounts ORDER BY id')
    const groupOf = new Map<string, number>() // 帳戶名稱 → 群組 id
    ;(config.accountGroups ?? []).forEach((group, i) => {
      const id = Number(
        tx.insert(t.financeAccountGroups).values({ name: group.name, sortOrder: i, createdAt: now }).run()
          .lastInsertRowid,
      )
      for (const name of group.accounts) {
        const matches = accounts.filter((a) => a.name === name && (a.type === 'asset' || a.type === 'liability'))
        if (matches.length !== 1) fail(`import-v2.json:群組「${group.name}」的帳戶「${name}」找不到,或不只一個`)
        if (groupOf.has(name)) fail(`import-v2.json:帳戶「${name}」出現在兩個群組`)
        groupOf.set(name, id)
      }
    })
    const inserted = new Set<number>()
    let pending = accounts
    while (pending.length) {
      // 子分類要等上層先寫入(外鍵)
      const ready = pending.filter((a) => a.parent_id === null || inserted.has(Number(a.parent_id)))
      if (!ready.length) fail('帳戶的 parent_id 形成循環')
      for (const a of ready) {
        const grouped = a.type === 'asset' || a.type === 'liability'
        tx.insert(t.financeAccounts)
          .values({
            id: Number(a.id),
            name: String(a.name),
            type: a.type as (typeof t.financeAccounts.$inferInsert)['type'],
            subtype: a.subtype as string | null,
            parentId: a.parent_id as number | null,
            currency: a.currency as string | null,
            groupId: grouped ? (groupOf.get(String(a.name)) ?? null) : null,
            color: a.color as string | null,
            sortOrder: Number(a.sort_order),
            isActive: a.is_active === 1,
            isSystem: a.is_system === 1,
            legacyId: a.legacy_id as string | null,
            createdAt: String(a.created_at),
          })
          .run()
        inserted.add(Number(a.id))
      }
      pending = pending.filter((a) => !inserted.has(Number(a.id)))
    }
    stats['帳戶'] = accounts.length
    stats['帳戶群組'] = (config.accountGroups ?? []).length

    // ── 收款人與別名 ────────────────────────────────────────────
    // 同一個正規化文字 = 同一個收款人;payeeMerges 再把寫法不同的併在一起
    const rawPayees = rows(
      `SELECT payee, COUNT(*) AS n FROM finance_transactions
       WHERE payee IS NOT NULL AND trim(payee) <> '' GROUP BY payee ORDER BY n DESC, payee`,
    )
    const mergeInto = new Map<string, string>() // 別名 → 併入的別名
    const mergeName = new Map<string, string>() // 併入的別名 → 顯示名稱
    for (const merge of config.payeeMerges ?? []) {
      mergeName.set(norm(merge.into), payeeDisplayName(merge.into, suffixes))
      for (const from of merge.from) mergeInto.set(norm(from), norm(merge.into))
    }
    const canonical = (raw: string) => mergeInto.get(norm(raw)) ?? norm(raw)
    const payeeIdOf = new Map<string, number>() // 代表別名 → 收款人 id
    const aliasSeen = new Set<string>()
    for (const r of rawPayees) {
      const raw = String(r.payee)
      const key = canonical(raw)
      if (!payeeIdOf.has(key)) {
        // rawPayees 依出現次數排序,所以顯示名稱取最常見的寫法
        const name = mergeName.get(key) ?? payeeDisplayName(raw, suffixes)
        payeeIdOf.set(
          key,
          Number(tx.insert(t.financePayees).values({ name, createdAt: now }).run().lastInsertRowid),
        )
      }
      const alias = norm(raw)
      if (!aliasSeen.has(alias)) {
        tx.insert(t.financePayeeAliases).values({ alias, payeeId: payeeIdOf.get(key)! }).run()
        aliasSeen.add(alias)
      }
    }
    // payeeMerges 的寫法在 v2 的資料裡沒出現過時(例:對帳單匯入才會看到的寫法)也建別名,
    // 讓之後的匯入對到同一個收款人。into 必須是 v2 的資料裡有的對象
    let extraAliases = 0
    for (const merge of config.payeeMerges ?? []) {
      const key = norm(merge.into)
      // 比的是 v2 的原始寫法:只有 from 出現過時,payeeIdOf 也會有 into 的鍵,但 into 本身沒有別名
      if (!aliasSeen.has(key)) {
        fail(`import-v2.json 的 payeeMerges:into「${merge.into}」在 v2 的資料裡沒有出現過`)
      }
      for (const alias of merge.from.map(norm)) {
        if (aliasSeen.has(alias)) continue
        tx.insert(t.financePayeeAliases).values({ alias, payeeId: payeeIdOf.get(key)! }).run()
        aliasSeen.add(alias)
        extraAliases++
      }
    }
    const payeeIdOfRaw = (raw: string | null) =>
      raw === null || raw.trim() === '' ? null : payeeIdOf.get(canonical(raw))!
    stats['收款人'] =
      `${rawPayees.length} 種寫法 → ${payeeIdOf.size} 個(別名 ${aliasSeen.size} 條,其中 ${extraAliases} 條只來自 payeeMerges)`

    // ── 週期項目:比對對象從子字串改成收款人 ─────────────────────
    for (const s of rows('SELECT * FROM finance_scheduled_transactions ORDER BY id')) {
      const linked = old
        .prepare('SELECT DISTINCT payee FROM finance_transactions WHERE scheduled_id = ?')
        .all(s.id) as { payee: string | null }[]
      const ids = new Set(linked.map((r) => payeeIdOfRaw(r.payee)))
      if (ids.size !== 1 || ids.has(null)) {
        fail(
          `週期項目「${s.name}」配對到的交易有 ${ids.size} 個不同的收款人(${linked.map((r) => r.payee).join('、')});` +
            '在 import-v2.json 的 payeeMerges 把它們併成一個',
        )
      }
      tx.insert(t.financeScheduledTransactions)
        .values({
          id: Number(s.id),
          name: String(s.name),
          accountId: Number(s.account_id),
          payeeId: [...ids][0]!,
          amountMin: Number(s.amount_min),
          amountMax: Number(s.amount_max),
          currency: String(s.currency),
          frequency: s.frequency as (typeof t.financeScheduledTransactions.$inferInsert)['frequency'],
          interval: Number(s.interval),
          startsOn: s.starts_on as string | null,
          endsOn: s.ends_on as string | null,
          note: s.note as string | null,
          isActive: s.is_active === 1,
          createdAt: String(s.created_at),
        })
        .run()
    }

    // ── 交易、分錄 ──────────────────────────────────────────────
    const transactions = rows('SELECT * FROM finance_transactions ORDER BY id')
    for (const r of transactions) {
      const raw = r.payee as string | null
      // 原始的對象文字留在 import_meta(只供還原與稽核);v1 沒留下原始值的交易在這裡補上
      const meta = r.import_meta === null ? {} : JSON.parse(String(r.import_meta))
      if (raw !== null && typeof meta.payee_original !== 'string') meta.payee_original = raw
      tx.insert(t.financeTransactions)
        .values({
          id: Number(r.id),
          occurredAt: String(r.occurred_at),
          payeeId: payeeIdOfRaw(raw),
          note: r.note as string | null,
          source: r.source as (typeof t.financeTransactions.$inferInsert)['source'],
          externalId: r.external_id as string | null,
          scheduledId: r.scheduled_id as number | null,
          importMeta: Object.keys(meta).length ? JSON.stringify(meta) : null,
          categorySource: r.category_source as (typeof t.financeTransactions.$inferInsert)['categorySource'],
          createdAt: String(r.created_at),
          updatedAt: String(r.updated_at),
        })
        .run()
    }
    const postings = rows('SELECT * FROM finance_postings ORDER BY id')
    for (const p of postings) {
      tx.insert(t.financePostings)
        .values({
          id: Number(p.id),
          transactionId: Number(p.transaction_id),
          accountId: Number(p.account_id),
          amount: Number(p.amount),
          currency: String(p.currency),
          memo: p.memo as string | null,
          sortOrder: Number(p.sort_order),
        })
        .run()
    }
    stats['交易'] = transactions.length
    stats['分錄'] = postings.length

    // ── 標籤 ────────────────────────────────────────────────────
    for (const g of rows('SELECT * FROM finance_tags ORDER BY id')) {
      tx.insert(t.financeTags)
        .values({
          id: Number(g.id),
          name: String(g.name),
          color: g.color as string | null,
          startsOn: g.starts_on as string | null,
          endsOn: g.ends_on as string | null,
          createdAt: String(g.created_at),
        })
        .run()
    }
    const links = rows('SELECT * FROM finance_transaction_tags')
    for (const l of links) {
      tx.insert(t.financeTransactionTags)
        .values({ transactionId: Number(l.transaction_id), tagId: Number(l.tag_id) })
        .run()
    }
    stats['標記'] = links.length

    // ── 匯率:不從 v2 帶,沿用目前資料庫裡的(由 finance:fx-update 維護)──────
    if (existsSync(DB_PATH)) {
      const current = new Database(DB_PATH, { readonly: true, fileMustExist: true })
      const rates = current.prepare('SELECT * FROM finance_fx_rates').all() as Row[]
      for (const r of rates) {
        tx.insert(t.financeFxRates)
          .values({
            date: String(r.date),
            currency: String(r.currency),
            rateToEur: Number(r.rate_to_eur),
            source: String(r.source),
            fetchedAt: String(r.fetched_at),
          })
          .run()
      }
      const quotes = current.prepare('SELECT * FROM finance_fx_direct_quotes').all() as Row[]
      for (const r of quotes) {
        tx.insert(t.financeFxDirectQuotes)
          .values({
            date: String(r.date),
            base: String(r.base),
            quote: String(r.quote),
            rate: Number(r.rate),
            source: String(r.source),
            fetchedAt: String(r.fetched_at),
          })
          .run()
      }
      current.close()
      stats['匯率(沿用)'] = `${rates.length} 筆、直接報價 ${quotes.length} 筆`
    } else {
      stats['匯率'] = '沒有;匯入後跑 npm run finance:fx-update'
    }

    // ── 規則:對象規則從文字比對展開成每個符合的收款人一條 ────────
    const dropped: string[] = []
    const ruleSeen = new Set<string>()
    let payeeRules = 0
    let categoryRules = 0
    const textMatches = (operator: string, raw: string, value: string) => {
      const a = raw.toLowerCase()
      const b = value.toLowerCase()
      return operator === 'equals' ? a === b : operator === 'starts_with' ? a.startsWith(b) : a.includes(b)
    }
    for (const r of rows('SELECT * FROM finance_rules ORDER BY priority, id')) {
      const common = {
        assignAccountId: r.assign_account_id as number | null,
        assignTags: String(r.assign_tags),
        priority: Number(r.priority),
        isActive: r.is_active === 1,
        createdAt: String(r.created_at),
      }
      if (r.match_field === 'source_category') {
        if (r.match_operator !== 'equals') fail(`來源分類規則「${r.match_value}」不是完全相同的比對,無法匯入`)
        tx.insert(t.financeRules)
          .values({ ...common, matchField: 'source_category', matchValue: String(r.match_value) })
          .run()
        categoryRules += 1
        continue
      }
      const ids = new Set(
        rawPayees
          .filter((p) => textMatches(String(r.match_operator), String(p.payee), String(r.match_value)))
          .map((p) => payeeIdOfRaw(String(p.payee))!),
      )
      if (!ids.size) dropped.push(String(r.match_value))
      for (const payeeId of ids) {
        const key = `${payeeId}|${common.assignAccountId}|${common.assignTags}`
        if (ruleSeen.has(key)) continue // 兩條舊規則指到同一個收款人、同一個結果
        ruleSeen.add(key)
        tx.insert(t.financeRules).values({ ...common, matchField: 'payee', payeeId }).run()
        payeeRules += 1
      }
    }
    stats['規則'] = `來源分類 ${categoryRules} 條、收款人 ${payeeRules} 條`
    if (dropped.length) stats['沒有對應收款人而略過的對象規則'] = dropped.join('、')

    const unbalanced = tx.all<{ n: number }>(sql`SELECT COUNT(*) AS n FROM finance_v_unbalanced`)[0].n
    if (unbalanced) fail(`有 ${unbalanced} 筆交易借貸不平`)
  })
  old.close()
  db.$client.close()

  console.log('── 匯入 ──')
  for (const [key, value] of Object.entries(stats)) console.log(`  ${key}:${value}`)

  const verify = spawnSync(
    process.execPath,
    [...process.execArgv, join(__dirname, 'verify-import.ts'), V2_DB_PATH, tmpPath, CONFIG_PATH, DB_PATH],
    { stdio: 'inherit' },
  )
  if (verify.status !== 0) fail('驗證沒有通過,資料庫沒有更新')
  mkdirSync(dirname(DB_PATH), { recursive: true })
  copyFileSync(tmpPath, DB_PATH)
  console.log(`\n✓ 已產生 ${DB_PATH}`)
}

main()
