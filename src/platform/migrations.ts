// 套用 migration 的唯一入口(各工具的 tools/migrate.ts、測試、匯入工具都經過這裡)。
//
// 為什麼不直接用 Drizzle 的 migrate:SQLite 改 CHECK、改欄位要重建資料表,Drizzle Kit 產生的做法是
// 「PRAGMA foreign_keys=OFF → 建新表 → DROP 舊表 → 改名」。但 Drizzle 把 migration 包在 transaction 裡,
// transaction 裡的 PRAGMA foreign_keys 不生效;外鍵開著時 DROP TABLE 會先做隱含的 DELETE,
// 觸發子表的 ON DELETE CASCADE,把子表的資料一起刪掉。
// 這裡在 transaction 外先關外鍵(SQLite 官方文件的重建步驟),套完再檢查有沒有斷掉的參照。
import Database from 'better-sqlite3'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

type Violation = { table: string; rowid: number | null; parent: string; fkid: number }

// migration 套用後有資料指到不存在的父列。migration 已經提交,只能報錯
export class MigrationIntegrityError extends Error {
  constructor(readonly violations: Violation[]) {
    const tables = [...new Set(violations.map((v) => `${v.table} → ${v.parent}`))].join('、')
    super(`migration 套用後有 ${violations.length} 列外鍵指不到資料(${tables})`)
    this.name = 'MigrationIntegrityError'
  }
}

export function runMigrations(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: BetterSQLite3Database<any> & { $client: Database.Database },
  migrationsFolder: string,
): void {
  const sqlite = db.$client
  if (sqlite.inTransaction) throw new Error('runMigrations 不能在 transaction 裡呼叫(外鍵關不掉)')
  const wasOn = sqlite.pragma('foreign_keys', { simple: true }) === 1
  sqlite.pragma('foreign_keys = OFF')
  try {
    migrate(db, { migrationsFolder })
    const violations = sqlite.pragma('foreign_key_check') as Violation[]
    if (violations.length) throw new MigrationIntegrityError(violations)
  } finally {
    if (wasOn) sqlite.pragma('foreign_keys = ON')
  }
}
