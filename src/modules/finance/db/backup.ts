import { existsSync, unlinkSync } from 'node:fs'
import { sql } from 'drizzle-orm'
import type { FinanceConn } from './index'

// 把整個資料庫寫成一份新的檔案(已存在就覆蓋)。用 SQLite 的 VACUUM INTO:
// 從同一條連線讀出一致的內容,WAL 裡還沒寫回主檔的變更也包含在內,不必先 checkpoint 再複製檔案。
// 不能在 DB transaction 裡呼叫
export function backupDatabase(db: FinanceConn, target: string): void {
  if (existsSync(target)) unlinkSync(target)
  db.run(sql`VACUUM INTO ${target}`)
}
