import { toolDataPath } from '../../../platform/dataDir'

// 資料庫檔的唯一定義;連線與 Drizzle 設定都讀這裡。
// FINANCE_DB_PATH 只給測試用(':memory:'),正常執行不設
export const DB_PATH = process.env.FINANCE_DB_PATH ?? toolDataPath('finance', 'finance.db')
