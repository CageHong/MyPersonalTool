// 對帳單匯入的套用:跟試跑同樣的檔案(欄位 files)+ 試跑拿到的指紋(欄位 fingerprint)。
// 伺服器重算計畫,指紋不同就不寫(400,fields.fingerprint = 'stale');套用前備份資料庫
import { getDb } from '@/modules/finance/db'
import { BACKUP_BEFORE_IMPORT_PATH } from '@/modules/finance/db/path'
import { loadImportOptions } from '@/modules/finance/server/import/options'
import { applyStatementFiles } from '@/modules/finance/server/import/prepare'
import { errorResponse, handleError, readFormFiles } from '@/app/api/_lib/http'

export async function POST(request: Request): Promise<Response> {
  const body = await readFormFiles(request, 'files')
  if (!body) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Request body must be multipart form data with files', {
      files: 'required',
    })
  }
  const fingerprint = body.form.get('fingerprint')
  if (typeof fingerprint !== 'string' || !fingerprint) {
    return errorResponse(400, 'VALIDATION_FAILED', 'fingerprint is required', { fingerprint: 'required' })
  }
  try {
    return Response.json(
      applyStatementFiles(getDb(), body.files, loadImportOptions(), {
        fingerprint,
        backupPath: BACKUP_BEFORE_IMPORT_PATH,
      }),
    )
  } catch (error) {
    return handleError('[POST /api/finance/import/apply]', error, 'Not found')
  }
}
