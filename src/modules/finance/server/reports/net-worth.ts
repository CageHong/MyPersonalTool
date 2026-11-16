// 淨資產、可動用資金、側欄的帳戶清單(唯讀)。餘額一律經過 ledger 的 getAccountBalances;
// 換算用最新的匯率(asOf 那一天或之前最近的一筆)。語意見 docs/finance/reports.md
import type { FinanceDb } from '../../db/index'
import type { NetWorth, SidebarGroup } from '../../lib/net-worth'
import { FxRateMissingError, convert } from '../fx/index'
import { listAccountGroups } from '../ledger/account-groups'
import { getAccountBalances } from '../ledger/balances'
import { getCurrencyExponents, getDisplayCurrency } from '../ledger/lookups'

// 流動性分類「現金及約當現金」的子類型
const AVAILABLE_SUBTYPES = new Set(['cash', 'bank'])

export function getNetWorth(db: FinanceDb, asOf: string): NetWorth {
  const display = getDisplayCurrency(db)
  const exponents = getCurrencyExponents(db)
  const balances = new Map(getAccountBalances(db).map((b) => [b.accountId, b.amount]))
  const { groups, accounts } = listAccountGroups(db)

  // 換算失敗(缺匯率)回傳 null
  const toCurrency = (amount: number, from: string, to: string): number | null => {
    try {
      return convert(db, amount, { currency: from, exponent: exponents[from] ?? 2 }, { currency: to, exponent: exponents[to] ?? 2 }, asOf)
    } catch (error) {
      if (error instanceof FxRateMissingError) return null
      throw error
    }
  }

  let netWorth = 0
  let available = 0
  let missingRate = 0
  for (const account of accounts) {
    const balance = balances.get(account.id) ?? 0
    if (balance === 0) continue
    const value = toCurrency(balance, account.currency, display)
    if (value === null) {
      missingRate += 1
      continue
    }
    netWorth += value
    if (account.subtype !== null && AVAILABLE_SUBTYPES.has(account.subtype)) available += value
  }

  // 清單:封存的帳戶餘額為 0 時不列(不為 0 的照列,合計才對得上)
  const visible = accounts.filter((a) => a.isActive || (balances.get(a.id) ?? 0) !== 0)
  const buckets = [...groups.map((g) => ({ id: g.id as number | null, name: g.name, currency: g.currency })), { id: null, name: '未分組', currency: null }]
  const sidebarGroups: SidebarGroup[] = []
  for (const bucket of buckets) {
    const members = visible.filter((a) => a.groupId === bucket.id)
    if (!members.length) continue
    const currency = bucket.currency ?? display
    let total: number | null = 0
    for (const account of members) {
      const balance = balances.get(account.id) ?? 0
      const value = balance === 0 ? 0 : toCurrency(balance, account.currency, currency)
      total = value === null || total === null ? null : total + value
    }
    sidebarGroups.push({
      id: bucket.id,
      name: bucket.name,
      currency,
      total: total === null ? null : Math.round(total),
      accounts: members.map((a) => ({
        id: a.id,
        name: a.name,
        type: a.type,
        currency: a.currency,
        balance: balances.get(a.id) ?? 0,
        isActive: a.isActive,
      })),
    })
  }

  return {
    currency: display,
    exponents,
    asOf,
    netWorth: Math.round(netWorth),
    available: Math.round(available),
    groups: sidebarGroups,
    missingRate,
  }
}
