// 收款人管理:API 回傳的形狀,前後端共用

export type PayeeAdminRow = {
  id: number
  name: string
  transactionCount: number
  // 匯入時對到這個收款人的寫法(正規化後:小寫、整理空白、去掉付款處理商後綴)
  aliases: string[]
  rules: number
  scheduled: number
}
