import { existsSync, readFileSync } from 'node:fs'
import { IMPORT_V2_CONFIG_PATH } from '../../db/path'
import type { ImportOptions } from './index'

// 對帳單匯入的選項。目前只有對象的後綴清單,沿用 import-v2.json 的 payeeSuffixes,
// 保證跟 finance:import-v2 用同一份(v2 退場時再搬家)。檔案不存在時是空清單。
// 命令列與 API 都經過這裡,不各自讀檔
export function loadImportOptions(path: string = IMPORT_V2_CONFIG_PATH): ImportOptions {
  if (!existsSync(path)) return { payeeSuffixes: [] }
  const config: { payeeSuffixes?: string[] } = JSON.parse(readFileSync(path, 'utf-8'))
  return { payeeSuffixes: config.payeeSuffixes ?? [] }
}
