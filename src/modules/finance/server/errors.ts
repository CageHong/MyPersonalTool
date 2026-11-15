// finance 的業務錯誤。route handler 用 instanceof 對映到 HTTP 狀態碼;這裡不知道 HTTP。
// 繼承平台的基底:route handler 只認基底(src/app/api/_lib/http.ts)
import { NotFoundErrorBase, ValidationErrorBase } from '../../../platform/errors'

// 輸入不合法。fields:哪個欄位、什麼問題
export class ValidationError extends ValidationErrorBase {
  constructor(fields: Record<string, string>) {
    super(`Validation failed: ${JSON.stringify(fields)}`, fields)
  }
}

export class NotFoundError extends NotFoundErrorBase {
  constructor(entity: string, id: number) {
    super(`${entity} ${id} not found`, id)
  }
}
