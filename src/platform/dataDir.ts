import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

// 資料(各工具的 SQLite 檔、匯入用的設定)不放在 repo 裡。
// 位置由 PERSONAL_TOOLS_DATA_DIR 指定;沒設定時是 repo 旁邊的 personal-tools-data/。
// 指令與伺服器一律在 repo 根目錄啟動,所以用工作目錄推算
function dataDir(): string {
  const raw = process.env.PERSONAL_TOOLS_DATA_DIR ?? join(process.cwd(), '..', 'personal-tools-data')
  return resolve(raw.startsWith('~') ? join(homedir(), raw.slice(1)) : raw)
}

// 每個工具一個子資料夾:<資料夾>/<工具>/<檔名>
export function toolDataPath(tool: string, ...segments: string[]): string {
  return join(dataDir(), tool, ...segments)
}
