// 對帳單匯入的試跑:上傳的檔案(欄位 files,可以多個)→ 匯入計畫的摘要。資料庫不變
import { getDb } from '@/modules/finance/db'
import { loadImportOptions } from '@/modules/finance/server/import/options'
import { previewStatementFiles } from '@/modules/finance/server/import/prepare'
import { errorResponse, handleError, readFormFiles } from '@/app/api/_lib/http'

export async function POST(request: Request): Promise<Response> {
  const body = await readFormFiles(request, 'files')
  if (!body) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Request body must be multipart form data with files', {
      files: 'required',
    })
  }
  try {
    return Response.json(previewStatementFiles(getDb(), body.files, loadImportOptions()))
  } catch (error) {
    return handleError('[POST /api/finance/import/plan]', error, 'Not found')
  }
}
