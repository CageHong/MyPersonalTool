import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { toolDataPath } from './dataDir'

// App 圖示(Safari「加入 Dock」、手機加到主畫面、瀏覽器分頁)屬於資料,不進 git:
// 使用者把圖放在 <資料夾>/platform/icon.png。只認這個檔名,資料夾裡的其他檔案一律不理會。
// 沒有這個檔、或它不符合規範時,改用 repo 內建的預設圖示

export const MIN_ICON_SIZE = 180

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export type IconCheck = { ok: true } | { ok: false; reason: string }

// 規範:PNG、正方形、至少 MIN_ICON_SIZE。寬高讀 PNG 檔頭的 IHDR,不需要影像套件
export function checkIconPng(bytes: Buffer): IconCheck {
  if (
    bytes.length < 24 ||
    !bytes.subarray(0, 8).equals(PNG_SIGNATURE) ||
    bytes.toString('ascii', 12, 16) !== 'IHDR'
  ) {
    return { ok: false, reason: 'not a PNG file' }
  }
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  if (width !== height) {
    return { ok: false, reason: `not square (${width}x${height})` }
  }
  if (width < MIN_ICON_SIZE) {
    return { ok: false, reason: `too small (${width}x${height}, minimum ${MIN_ICON_SIZE}x${MIN_ICON_SIZE})` }
  }
  return { ok: true }
}

export type AppIcon = {
  bytes: Buffer
  source: 'custom' | 'default'
  // 有自訂圖示但不能用時的原因;沒有自訂圖示屬於正常情況,不帶原因
  fallbackReason?: string
}

export function customIconPath(): string {
  return toolDataPath('platform', 'icon.png')
}

// 伺服器一律在 repo 根目錄啟動(見 dataDir.ts),所以用工作目錄推算
export function defaultIconPath(): string {
  return join(process.cwd(), 'src', 'platform', 'assets', 'default-icon.png')
}

// 預設圖示讀不到時直接 throw:那是 repo 壞了,不是使用者的問題
export function loadAppIcon(customPath = customIconPath(), defaultPath = defaultIconPath()): AppIcon {
  const fallBackToDefault = (fallbackReason?: string): AppIcon => ({
    bytes: readFileSync(defaultPath),
    source: 'default',
    ...(fallbackReason && { fallbackReason }),
  })

  let bytes: Buffer
  try {
    bytes = readFileSync(customPath)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return code === 'ENOENT' ? fallBackToDefault() : fallBackToDefault(`cannot read ${customPath} (${code ?? 'unknown error'})`)
  }

  const check = checkIconPng(bytes)
  if (!check.ok) {
    return fallBackToDefault(`${customPath}: ${check.reason}`)
  }
  return { bytes, source: 'custom' }
}
