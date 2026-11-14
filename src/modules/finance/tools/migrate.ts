// 套用 finance 還沒套用過的 migration:npm run finance:db:migrate(在 repo 根目錄執行)
import { applyMigrations, openDb } from '../db/index'
import { DB_PATH } from '../db/path'

const db = openDb(DB_PATH)
applyMigrations(db)
db.$client.close()
console.log(`✓ migration 已套用:${DB_PATH}`)
