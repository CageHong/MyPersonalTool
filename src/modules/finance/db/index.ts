import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import Database from 'better-sqlite3'
import type { RunResult } from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'
import * as schema from './schema'

export type FinanceDb = ReturnType<typeof openDb>

// 連線,或 db.transaction() 裡拿到的 tx。會被別的寫入函式包在同一個 DB transaction 裡呼叫的函式收這個型別
export type FinanceConn = BaseSQLiteDatabase<'sync', RunResult, typeof schema>

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
