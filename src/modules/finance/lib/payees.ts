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

// 收款人管理頁的排序(網址參數 sort):name = 名稱(不分大小寫),count = 交易筆數由多到少、同筆數依名稱
export const PAYEE_SORTS = [
  { key: 'name', label: '依名稱' },
  { key: 'count', label: '依筆數' },
] as const
export type PayeeSort = (typeof PAYEE_SORTS)[number]['key']

// 網址參數 → 排序;沒有或認不得的值當成 name
export function parsePayeeSort(value: string | null): PayeeSort {
  return value === 'count' ? 'count' : 'name'
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

export function sortPayees<T extends { name: string; transactionCount: number }>(rows: T[], sort: PayeeSort): T[] {
  const byName = (a: T, b: T) => collator.compare(a.name, b.name)
  return [...rows].sort(sort === 'count' ? (a, b) => b.transactionCount - a.transactionCount || byName(a, b) : byName)
}
