import { createHash } from 'node:crypto'
import { loadAppIcon } from '@/platform/icon'
import { errorResponse } from '../../_lib/http'

// App 圖示。換圖只要覆蓋資料夾裡的 platform/icon.png,不用重新 build:
// route handler 預設不快取,每次請求都重新讀檔;瀏覽器用 ETag 確認圖有沒有變
export function GET(request: Request): Response {
  try {
    const icon = loadAppIcon()
    if (icon.fallbackReason) {
      console.warn(`[icon] using default icon: ${icon.fallbackReason}`)
    }
    const etag = `"${createHash('sha1').update(icon.bytes).digest('hex')}"`
    const headers = { ETag: etag, 'Cache-Control': 'no-cache' }
    if (request.headers.get('if-none-match') === etag) {
      return new Response(null, { status: 304, headers })
    }
    return new Response(new Uint8Array(icon.bytes), {
      headers: { ...headers, 'Content-Type': 'image/png' },
    })
  } catch (error) {
    console.error('[icon]', error)
    return errorResponse(500, 'INTERNAL_ERROR', 'Internal server error')
  }
}
