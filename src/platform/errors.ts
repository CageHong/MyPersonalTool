// 各工具業務錯誤的基底。工具在自己的 server/ 定義錯誤類別並繼承這兩個;
// route handler 的共用函式(src/app/api/_lib/http.ts)只認基底,所以不必匯入任何工具。
// 這裡跟工具的 server/ 一樣不知道 HTTP:狀態碼的對映只在 http.ts。

// 輸入不合法。fields:哪個欄位、什麼問題
export class ValidationErrorBase extends Error {
  readonly fields: Record<string, string>

  constructor(message: string, fields: Record<string, string>) {
    super(message)
    this.name = 'ValidationError'
    this.fields = fields
  }
}

// 指定的 id 不存在
export class NotFoundErrorBase extends Error {
  readonly id: number

  constructor(message: string, id: number) {
    super(message)
    this.name = 'NotFoundError'
    this.id = id
  }
}
