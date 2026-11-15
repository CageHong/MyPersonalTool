import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import Database from 'better-sqlite3'
import type { RunResult } from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'
import { runMigrations } from '../../../platform/migrations'
import { DB_PATH } from './path'
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

export const MIGRATIONS_FOLDER = join(process.cwd(), 'src/modules/finance/drizzle')

// 套用還沒套用過的 migration(經過平台的 runMigrations,重建資料表時不會連帶刪掉子表)。
// 指令一律在 repo 根目錄執行
export function applyMigrations(db: FinanceDb) {
  runMigrations(db, MIGRATIONS_FOLDER)
}

// route handler 用的共用連線(資料庫在 DB_PATH)。
// next dev 的 HMR 會重新求值模組,不快取在 globalThis 的話每次存檔都多開一條連線。
// 不在這裡套用 migration:結構變更一律由 finance:db:migrate 執行。
// 資料庫不存在時不自動建立(建出來的會是沒有結構的空檔案),直接報錯
const globalForDb = globalThis as unknown as { financeDb?: FinanceDb }

export function getDb(): FinanceDb {
  if (!globalForDb.financeDb) {
    if (DB_PATH !== ':memory:' && !existsSync(DB_PATH)) {
      throw new Error(`找不到 finance 的資料庫 ${DB_PATH}`)
    }
    globalForDb.financeDb = openDb(DB_PATH)
  }
  return globalForDb.financeDb
}
