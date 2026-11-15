import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { sql } from 'drizzle-orm'
import { openDb } from '../../db/index'
import type { FinanceDb } from '../../db/index'
import { ValidationError } from '../errors'
import { ACCOUNTS, AT, freshLedger } from '../testing'
import { ImportBlockedError } from './index'
import { loadImportOptions } from './options'
import {
  applyStatementFiles,
  planFingerprint,
  prepareImport,
  StatementFileError,
  summarizeImport,
} from './prepare'

const options = { payeeSuffixes: [] }

const COLUMNS = [
  'ID', 'Status', 'Direction', 'Created on', 'Source fee amount', 'Source fee currency', 'Source name',
  'Source amount (after fees)', 'Source currency', 'Target name', 'Target amount (after fees)',
  'Target currency', 'Exchange rate', 'Reference', 'Category', 'Note',
]

const DEFAULTS: Record<string, string> = {
  ID: 'CARD-1',
  Status: 'COMPLETED',
  Direction: 'OUT',
  'Created on': '2030-01-15 09:30:00',
  'Source fee amount': '0.00',
  'Source fee currency': 'EUR',
  'Source name': 'Alex Example',
  'Source amount (after fees)': '12.30',
  'Source currency': 'EUR',
  'Target name': 'Some Shop BV',
  'Target amount (after fees)': '12.30',
  'Target currency': 'EUR',
  'Exchange rate': '1.0',
}

const csv = (rows: Record<string, string>[]) =>
  [COLUMNS.join(','), ...rows.map((row) => COLUMNS.map((c) => row[c] ?? DEFAULTS[c] ?? '').join(','))].join('\n')

const exchange = {
  ID: 'BALANCE-1',
  Direction: 'NEUTRAL',
  'Source amount (after fees)': '200.00',
  'Source currency': 'USD',
  'Source fee amount': '0.80',
  'Source fee currency': 'USD',
  'Target amount (after fees)': '183.20',
  'Target currency': 'EUR',
  'Source name': '',
  'Target name': '',
}

// 子分類(上層 › 子分類)與一條來源分類規則
function ledgerWithRule(): FinanceDb {
  const db = freshLedger()
  db.run(sql`INSERT INTO finance_accounts (id, name, type, parent_id, created_at)
             VALUES (20, 'Groceries', 'expense', ${ACCOUNTS.food}, ${AT})`)
  db.run(sql`INSERT INTO finance_rules (match_field, match_value, assign_account_id, created_at)
             VALUES ('source_category', 'Shopping', 20, ${AT})`)
  return db
}

const count = (db: FinanceDb) =>
  db.all<{ n: number }>(sql`SELECT COUNT(*) AS n FROM finance_transactions`)[0].n

const files = [
  { name: 'a.csv', text: csv([{ Category: 'Shopping', 'Source fee amount': '0.50' }, exchange]) },
]

test('prepareImport:沒有檔案、認不出來源、缺欄位都是驗證錯誤,訊息帶檔名', () => {
  const db = freshLedger()
  assert.throws(
    () => prepareImport(db, [], options),
    (error: unknown) => error instanceof ValidationError && error.fields.files === 'required',
  )
  assert.throws(
    () => prepareImport(db, [{ name: 'notes.txt', text: 'hello\nworld' }], options),
    (error: unknown) =>
      error instanceof StatementFileError &&
      error instanceof ValidationError &&
      error.fields.files.startsWith('notes.txt:'),
  )
})

test('summarizeImport:新交易的分類名稱、來源那一側的金額、各種筆數', () => {
  const db = ledgerWithRule()
  const summary = summarizeImport(db, prepareImport(db, files, options))
  assert.equal(summary.canApply, true)
  assert.deepEqual(summary.files, [{ name: 'a.csv', transactions: 2 }])
  assert.equal(summary.counts.new, 2)
  assert.deepEqual(summary.classification, {
    scheduled: 0, rule: 0, payeeHistory: 0, sourceCategory: 1, unclassified: 0, exchange: 1,
  })
  const [card, swap] = summary.newItems
  assert.equal(card.category, 'Food › Groceries')
  assert.equal(card.categorySource, 'source_category')
  assert.equal(card.payee, 'Some Shop BV')
  assert.deepEqual(card.source, [{ account: 'Wise EUR', currency: 'EUR', amount: -1280 }])
  assert.equal(swap.kind, 'exchange')
  assert.equal(swap.category, null)
  assert.deepEqual(swap.source, [
    { account: 'Wise USD', currency: 'USD', amount: -20080 },
    { account: 'Wise EUR', currency: 'EUR', amount: 18320 },
  ])
  assert.equal(summary.exponents.EUR, 2)
})

test('指紋:同樣的輸入相同;套用之後沒有東西要寫,指紋改變、不能再套用', () => {
  const db = ledgerWithRule()
  const before = summarizeImport(db, prepareImport(db, files, options))
  assert.equal(before.fingerprint, planFingerprint(prepareImport(db, files, options).plan))
  const result = applyStatementFiles(db, files, options, { fingerprint: before.fingerprint, backupPath: null })
  assert.deepEqual(result, { created: 2, payeesFixed: 0, backupPath: null })
  const after = summarizeImport(db, prepareImport(db, files, options))
  assert.notEqual(after.fingerprint, before.fingerprint)
  assert.equal(after.canApply, false)
  assert.equal(after.counts.existing, 2)
})

test('套用:帳本在試跑之後變了(指紋不同)就不寫', () => {
  const db = ledgerWithRule()
  const { fingerprint } = summarizeImport(db, prepareImport(db, files, options))
  // 試跑之後規則被停用:新交易的分類會不同
  db.run(sql`UPDATE finance_rules SET is_active = 0`)
  assert.throws(
    () => applyStatementFiles(db, files, options, { fingerprint, backupPath: null }),
    (error: unknown) => error instanceof ValidationError && error.fields.fingerprint === 'stale',
  )
  assert.equal(count(db), 0)
})

test('套用:有無法處理的列就整份不寫,是驗證錯誤(plan = blocked)', () => {
  const db = freshLedger()
  const bad = [{ name: 'b.csv', text: csv([{ 'Source currency': 'CHF', 'Source fee currency': 'CHF' }]) }]
  const summary = summarizeImport(db, prepareImport(db, bad, options))
  assert.equal(summary.counts.errors, 1)
  assert.equal(summary.canApply, false)
  assert.throws(
    () => applyStatementFiles(db, bad, options, { fingerprint: summary.fingerprint, backupPath: null }),
    (error: unknown) =>
      error instanceof ImportBlockedError && error instanceof ValidationError && error.fields.plan === 'blocked',
  )
  assert.equal(count(db), 0)
})

test('套用前備份:備份檔是套用之前的帳本', () => {
  const dir = mkdtempSync(join(tmpdir(), 'finance-backup-'))
  const db = ledgerWithRule()
  const backupPath = join(dir, 'finance.db.before-import')
  writeFileSync(backupPath, 'old backup')
  const { fingerprint } = summarizeImport(db, prepareImport(db, files, options))
  applyStatementFiles(db, files, options, { fingerprint, backupPath })
  assert.equal(count(db), 2)
  const backup = openDb(backupPath)
  assert.equal(count(backup), 0)
  assert.equal(
    backup.all<{ n: number }>(sql`SELECT COUNT(*) AS n FROM finance_rules`)[0].n,
    1,
  )
})

test('loadImportOptions:沒有設定檔是空清單;有的話讀 payeeSuffixes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'finance-options-'))
  assert.deepEqual(loadImportOptions(join(dir, 'missing.json')), { payeeSuffixes: [] })
  const path = join(dir, 'import-v2.json')
  writeFileSync(path, JSON.stringify({ payeeSuffixes: ['via Processor'], payeeMerges: [] }))
  assert.deepEqual(loadImportOptions(path), { payeeSuffixes: ['via Processor'] })
})
