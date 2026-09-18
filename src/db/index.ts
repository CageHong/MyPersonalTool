import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'

// 與 drizzle.config.ts 的 dbCredentials.url 一致。
// TASKS_DB_PATH 只給測試用(':memory:'),正常執行不設
const DB_PATH = process.env.TASKS_DB_PATH ?? './data/tasks.db'

function createDb() {
  // data/ 不進版控,clone 下來時不存在
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
