// finance 的業務錯誤。route handler 用 instanceof 對映到 HTTP 狀態碼;這裡不知道 HTTP

// 輸入不合法。fields:哪個欄位、什麼問題
export class ValidationError extends Error {
  readonly fields: Record<string, string>

  constructor(fields: Record<string, string>) {
    super(`Validation failed: ${JSON.stringify(fields)}`)
    this.name = 'ValidationError'
    this.fields = fields
  }
}

export class NotFoundError extends Error {
  readonly id: number

  constructor(entity: string, id: number) {
    super(`${entity} ${id} not found`)
    this.name = 'NotFoundError'
    this.id = id
  }
}
