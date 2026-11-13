// 收款人:文字的正規化,以及「原始文字 → 收款人」的查詢與建立。
// 匯入的原始文字先正規化,再到別名表做完全相同的比對。
import { eq } from 'drizzle-orm'
import type { FinanceConn } from '../../db/index'
import { financePayeeAliases, financePayees } from '../../db/schema'

function collapse(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ')
}

// 去掉結尾的付款處理商後綴(例:「某商家 via 某處理商」)。suffixes 不含前面的空白,比對不分大小寫
function stripSuffix(text: string, suffixes: readonly string[]): string {
  const lower = text.toLowerCase()
  for (const suffix of suffixes) {
    const tail = ' ' + collapse(suffix).toLowerCase()
    if (tail.length > 1 && lower.length > tail.length && lower.endsWith(tail)) {
      return text.slice(0, text.length - tail.length)
    }
  }
  return text
}

// 別名表的鍵:去頭尾空白、連續空白合成一個、去掉後綴、轉小寫
export function normalizePayeeText(raw: string, suffixes: readonly string[]): string {
  return stripSuffix(collapse(raw), suffixes).toLowerCase()
}

// 第一次看到這個文字時,收款人的顯示名稱:保留原本的大小寫,只整理空白與後綴
export function payeeDisplayName(raw: string, suffixes: readonly string[]): string {
  return stripSuffix(collapse(raw), suffixes)
}

// 別名表裡這個文字對到的收款人;沒有就是 null。只查不寫
export function findPayeeByText(
  db: FinanceConn,
  raw: string,
  suffixes: readonly string[],
): number | null {
  const alias = normalizePayeeText(raw, suffixes)
  if (alias === '') return null
  const [row] = db
    .select({ payeeId: financePayeeAliases.payeeId })
    .from(financePayeeAliases)
    .where(eq(financePayeeAliases.alias, alias))
    .all()
  return row?.payeeId ?? null
}

// 這個文字會對到的既有收款人:別名表有就用,沒有就找同名的收款人;都沒有是 null。只查不寫。
// 跟 resolvePayee 用同一個順序,所以試跑時查到的就是套用時會用的
export function lookupPayee(
  db: FinanceConn,
  raw: string,
  suffixes: readonly string[],
): number | null {
  const known = findPayeeByText(db, raw, suffixes)
  if (known !== null) return known
  const name = payeeDisplayName(raw, suffixes)
  if (name === '') return null
  const [sameName] = db
    .select({ id: financePayees.id })
    .from(financePayees)
    .where(eq(financePayees.name, name))
    .all()
  return sameName?.id ?? null
}

// 原始文字 → 收款人 id。別名表有就用;沒有就新增別名,掛到同名的收款人,同名的也沒有才新增收款人。
// 整理後是空字串時回傳 null
export function resolvePayee(
  db: FinanceConn,
  raw: string,
  suffixes: readonly string[],
  now: string = new Date().toISOString(),
): number | null {
  const alias = normalizePayeeText(raw, suffixes)
  if (alias === '') return null
  return db.transaction((tx) => {
    const known = findPayeeByText(tx, raw, suffixes)
    if (known !== null) return known
    const name = payeeDisplayName(raw, suffixes)
    const [sameName] = tx
      .select({ id: financePayees.id })
      .from(financePayees)
      .where(eq(financePayees.name, name))
      .all()
    const payeeId =
      sameName?.id ??
      tx
        .insert(financePayees)
        .values({ name, createdAt: now })
        .returning({ id: financePayees.id })
        .all()[0].id
    tx.insert(financePayeeAliases).values({ alias, payeeId }).run()
    return payeeId
  })
}
