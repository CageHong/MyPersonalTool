// 測試用:檢查最新的 migration 不會弄丟資料。
//
// 只套到倒數第二個 migration → 用 seed 灌資料 → 套最新的 → 回傳前後每張表的筆數與外鍵檢查。
// seed 要照「倒數第二版」的 schema 寫;migration 改到 seed 用到的欄位時,seed 跟著更新。
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { runMigrations } from '../migrations'

export type MigrationCheck = {
  // 最新 migration 的 tag;只有一個 migration 時是 null(沒有東西可以檢查)
  newest: string | null
  before: Record<string, number>
  after: Record<string, number>
  // 套用前就有、套用後筆數不同(或不見了)的資料表。新增的資料表不算
  changed: { table: string; before: number; after: number | null }[]
  violations: unknown[]
}

function tableCounts(sqlite: Database.Database): Record<string, number> {
  const tables = sqlite
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table'
       AND name NOT LIKE 'sqlite_%' AND name <> '__drizzle_migrations' ORDER BY name`,
    )
    .all() as { name: string }[]
  return Object.fromEntries(
    tables.map(({ name }) => [
      name,
      (sqlite.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get() as { n: number }).n,
    ]),
  )
}

export function checkNewestMigration(
  migrationsFolder: string,
  seed: (sqlite: Database.Database) => void,
): MigrationCheck {
  const journalPath = join(migrationsFolder, 'meta', '_journal.json')
  const journal = JSON.parse(readFileSync(journalPath, 'utf-8')) as { entries: { tag: string }[] }
  if (journal.entries.length < 2) {
    return { newest: null, before: {}, after: {}, changed: [], violations: [] }
  }

  const previous = mkdtempSync(join(tmpdir(), 'migration-check-'))
  try {
    cpSync(migrationsFolder, previous, { recursive: true })
    writeFileSync(
      join(previous, 'meta', '_journal.json'),
      JSON.stringify({ ...journal, entries: journal.entries.slice(0, -1) }),
    )
    const sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')
    const db = drizzle(sqlite)
    runMigrations(db, previous)
    seed(sqlite)
    const before = tableCounts(sqlite)
    runMigrations(db, migrationsFolder)
    const after = tableCounts(sqlite)
    const violations = sqlite.pragma('foreign_key_check') as unknown[]
    sqlite.close()
    const changed = Object.entries(before)
      .filter(([table, n]) => after[table] !== n)
      .map(([table, n]) => ({ table, before: n, after: after[table] ?? null }))
    return { newest: journal.entries.at(-1)!.tag, before, after, changed, violations }
  } finally {
    rmSync(previous, { recursive: true, force: true })
  }
}
