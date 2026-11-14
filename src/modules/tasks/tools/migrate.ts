// 套用 tasks 還沒套用過的 migration:npm run tasks:db:migrate(在 repo 根目錄執行)
import { applyMigrations, db } from '../db'
import { DB_PATH } from '../db/path'

applyMigrations()
db.$client.close()
console.log(`✓ migration 已套用:${DB_PATH}`)
