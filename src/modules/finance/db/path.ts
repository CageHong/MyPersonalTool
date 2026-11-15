import { toolDataPath } from '../../../platform/dataDir'

// finance 資料檔位置的唯一定義;連線、Drizzle 設定、匯入都讀這裡。
// FINANCE_DB_PATH 只給測試用(':memory:'),正常執行不設
export const DB_PATH = process.env.FINANCE_DB_PATH ?? toolDataPath('finance', 'finance.db')

// 套用對帳單之前的備份(每次覆蓋);命令列與 API 用同一個位置
export const BACKUP_BEFORE_IMPORT_PATH = `${DB_PATH}.before-import`

// 從 v2 匯入的設定;對帳單匯入也讀它的 payeeSuffixes(v2 退場時再搬家)
export const IMPORT_V2_CONFIG_PATH = toolDataPath('finance', 'import-v2.json')
