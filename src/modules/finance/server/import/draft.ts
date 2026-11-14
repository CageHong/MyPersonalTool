// 待匯入交易 → 分錄草稿(純函式,不碰資料庫)。
//
// 規則:
//   付出:來源帳戶 −(金額 + 手續費);未分類 + 金額;手續費 + 手續費
//   入帳:來源帳戶 + 金額;未分類收入 − 金額
//   換匯:流出的帳戶 −(金額 + 手續費);換匯 + 流出金額;換匯 − 流入金額;流入的帳戶 + 流入金額;手續費 + 手續費
// 分類在這裡一律是「未分類」;自動分類是之後的另一個步驟,只補未分類的交易。
import type { PendingTransaction } from '@personal-tools/statement-parsers'
import type { SystemAccounts } from '../ledger/accounts'
import type { NewPosting } from '../ledger/transactions'
import { toMinorUnits } from './amounts'

// 這一列無法轉成分錄(帳本裡沒有對應的帳戶或幣別、金額的小數位數不對)
export class DraftError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DraftError'
  }
}

export type DraftLookups = {
  // 來源的帳戶代號(例:'wise:EUR')→ 帳本的帳戶
  sourceAccounts: ReadonlyMap<string, { id: number; currency: string }>
  // 幣別 → 小數位數
  exponents: ReadonlyMap<string, number>
  system: SystemAccounts
}

export type DraftTransaction = {
  source: PendingTransaction['source']
  externalId: string | null
  occurredAt: string
  // 對象的原始文字:對方的名稱,沒有就用備註欄(Reference)
  payeeText: string | null
  note: string | null
  importMeta: Record<string, unknown>
  postings: NewPosting[]
}

export function buildDraft(pending: PendingTransaction, lookups: DraftLookups): DraftTransaction {
  const postings: NewPosting[] = []
  // 同一個帳戶、同一個幣別的金額合成一條分錄
  const add = (accountId: number, currency: string, amount: number) => {
    if (amount === 0) return
    const same = postings.find((p) => p.accountId === accountId && p.currency === currency)
    if (same) same.amount += amount
    else postings.push({ accountId, amount, currency })
  }
  const minor = (decimal: string, currency: string) => {
    const exponent = lookups.exponents.get(currency)
    if (exponent === undefined) throw new DraftError(`幣別表沒有 ${currency}`)
    try {
      return toMinorUnits(decimal, exponent)
    } catch (error) {
      throw new DraftError(error instanceof Error ? error.message : String(error))
    }
  }
  const sourceAccount = (code: string, currency: string) => {
    const account = lookups.sourceAccounts.get(code)
    if (!account) throw new DraftError(`帳本沒有對應 ${code} 的帳戶`)
    if (account.currency !== currency) {
      throw new DraftError(`${code} 對到的帳戶幣別是 ${account.currency},不是 ${currency}`)
    }
    return account.id
  }

  for (const movement of pending.movements) {
    const amount = minor(movement.amount, movement.currency)
    add(sourceAccount(movement.account, movement.currency), movement.currency, amount)
    const counter =
      pending.kind === 'exchange'
        ? lookups.system.exchange
        : pending.kind === 'out'
          ? lookups.system.uncategorizedExpense
          : lookups.system.uncategorizedIncome
    add(counter, movement.currency, -amount)
  }
  if (pending.fee) {
    const fee = minor(pending.fee.amount, pending.fee.currency)
    add(sourceAccount(pending.fee.account, pending.fee.currency), pending.fee.currency, -fee)
    add(lookups.system.fee, pending.fee.currency, fee)
  }
  // 金額是零的變動不記分錄(add),所以全部是零時一條都沒有;同一帳戶的金額合併後也可能變成零
  if (postings.length < 2 || postings.some((p) => p.amount === 0)) {
    throw new DraftError('金額是零或互相抵銷,沒有可以記的分錄')
  }

  return {
    source: pending.source,
    externalId: pending.externalId,
    occurredAt: pending.occurredAt,
    payeeText: pending.counterparty ?? pending.reference,
    note: pending.note,
    importMeta: {
      payee_original: pending.counterparty,
      source_category: pending.sourceCategory,
      row: pending.raw,
    },
    postings,
  }
}
