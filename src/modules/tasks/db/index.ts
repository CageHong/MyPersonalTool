import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { runMigrations } from '../../../platform/migrations'
import { DB_PATH } from './path'
import * as schema from './schema'

function createDb() {
  // 資料夾在 repo 外,第一次執行時不存在
  const dir = dirname(DB_PATH)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  const sqlite = new Database(DB_PATH)
  // SQLite 預設不強制外鍵;這個 pragma 是 per-connection,每條連線都要設
  sqlite.pragma('foreign_keys = ON')

  return drizzle(sqlite, { schema })
}

// next dev 的 HMR 會重新求值模組,不快取的話每次存檔都多開一條連線
const globalForDb = globalThis as unknown as { db?: ReturnType<typeof createDb> }

export const db = globalForDb.db ?? createDb()

if (process.env.NODE_ENV !== 'production') {
  globalForDb.db = db
}

export const MIGRATIONS_FOLDER = join(process.cwd(), 'src/modules/tasks/drizzle')

// 套用還沒套用過的 migration(經過平台的 runMigrations,重建資料表時不會連帶刪掉子表)。
// 指令一律在 repo 根目錄執行
export function applyMigrations(target: typeof db = db) {
  runMigrations(target, MIGRATIONS_FOLDER)
}
