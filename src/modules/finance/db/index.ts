import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from './schema'

export type FinanceDb = ReturnType<typeof openDb>

// 開一條連線。path 可以是 ':memory:'(測試用)
export function openDb(path: string) {
  if (path !== ':memory:') {
    const dir = dirname(path)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
  }
  const sqlite = new Database(path)
  // SQLite 預設不強制外鍵;這個 pragma 是 per-connection,每條連線都要設
  sqlite.pragma('foreign_keys = ON')
  return drizzle(sqlite, { schema })
}

// 套用還沒套用過的 migration。指令一律在 repo 根目錄執行
export function applyMigrations(db: FinanceDb) {
  migrate(db, { migrationsFolder: join(process.cwd(), 'src/modules/finance/drizzle') })
}
