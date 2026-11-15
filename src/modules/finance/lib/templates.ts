// 新增交易的範本:把表單的值變成一組平衡的分錄。純函式,畫面與測試共用。
// 範本只負責預先填好分錄;存進去的就是一般的交易,之後可以用分錄編輯器改

import type { PostingInput } from './edit'
import type { FinanceLookups } from './transactions'

export const TEMPLATES = [
  { key: 'expense', label: '支出' },
  { key: 'income', label: '收入' },
  { key: 'transfer', label: '轉帳' },
  { key: 'exchange', label: '換匯' },
  { key: 'reconcile', label: '對帳調整' },
] as const
export type TemplateKey = (typeof TEMPLATES)[number]['key']

// 金額都是最小貨幣單位的正整數
export type TemplateValues =
  | { template: 'expense' | 'income'; accountId: number; amount: number; categoryId: number }
  | { template: 'transfer'; fromId: number; toId: number; amount: number }
  | { template: 'exchange'; fromId: number; fromAmount: number; toId: number; toAmount: number }
  // difference = 實際餘額 − 帳上餘額(帳戶的幣別、最小單位);正 = 帳上少了,負 = 帳上多了
  | { template: 'reconcile'; accountId: number; difference: number; categoryId: number }

export type TemplateResult = { ok: true; postings: PostingInput[] } | { ok: false; error: string }

const posting = (accountId: number, amount: number, currency: string): PostingInput => ({
  accountId,
  amount,
  currency,
  memo: null,
})

export function buildTemplatePostings(values: TemplateValues, lookups: FinanceLookups): TemplateResult {
  const currencyOf = (id: number) => lookups.accounts.find((a) => a.id === id)?.currency ?? null
  switch (values.template) {
    case 'expense':
    case 'income': {
      const currency = currencyOf(values.accountId)
      if (!currency) return { ok: false, error: '請選擇帳戶。' }
      if (values.amount <= 0) return { ok: false, error: '金額要大於零。' }
      const sign = values.template === 'expense' ? -1 : 1
      return {
        ok: true,
        postings: [
          posting(values.accountId, sign * values.amount, currency),
          posting(values.categoryId, -sign * values.amount, currency),
        ],
      }
    }
    case 'transfer': {
      const from = currencyOf(values.fromId)
      const to = currencyOf(values.toId)
      if (!from || !to) return { ok: false, error: '請選擇兩個帳戶。' }
      if (values.fromId === values.toId) return { ok: false, error: '轉出與轉入不能是同一個帳戶。' }
      if (from !== to) return { ok: false, error: '兩個帳戶的幣別不同,請改用「換匯」。' }
      if (values.amount <= 0) return { ok: false, error: '金額要大於零。' }
      return { ok: true, postings: [posting(values.fromId, -values.amount, from), posting(values.toId, values.amount, to)] }
    }
    case 'exchange': {
      const from = currencyOf(values.fromId)
      const to = currencyOf(values.toId)
      if (!from || !to) return { ok: false, error: '請選擇兩個帳戶。' }
      if (from === to) return { ok: false, error: '兩個帳戶的幣別相同,請改用「轉帳」。' }
      if (values.fromAmount <= 0 || values.toAmount <= 0) return { ok: false, error: '兩邊的金額都要大於零。' }
      const exchange = lookups.system.exchange
      return {
        ok: true,
        postings: [
          posting(values.fromId, -values.fromAmount, from),
          posting(exchange, values.fromAmount, from),
          posting(values.toId, values.toAmount, to),
          posting(exchange, -values.toAmount, to),
        ],
      }
    }
    case 'reconcile': {
      const currency = currencyOf(values.accountId)
      if (!currency) return { ok: false, error: '請選擇帳戶。' }
      if (values.difference === 0) return { ok: false, error: '帳上餘額已經跟實際餘額一樣,不用調整。' }
      return {
        ok: true,
        postings: [
          posting(values.accountId, values.difference, currency),
          posting(values.categoryId, -values.difference, currency),
        ],
      }
    }
  }
}

// 對帳調整的差額要記到哪一類分類:帳上多了(差額為負,錢不見了)是支出,帳上少了是收入
export function reconcileCategoryType(difference: number): 'expense' | 'income' {
  return difference < 0 ? 'expense' : 'income'
}
