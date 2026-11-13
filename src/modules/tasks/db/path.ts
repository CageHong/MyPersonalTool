import { toolDataPath } from '../../../platform/dataDir'

// 資料庫檔的唯一定義;連線(index.ts)與 Drizzle 設定(drizzle.config.ts)都讀這裡。
// TASKS_DB_PATH 只給測試用(':memory:'),正常執行不設
export const DB_PATH = process.env.TASKS_DB_PATH ?? toolDataPath('tasks', 'tasks.db')
