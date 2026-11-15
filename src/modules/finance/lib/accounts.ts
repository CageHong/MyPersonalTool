// 帳戶與分類的選單選項(編輯面板、新增交易用)。只依賴 lookups,前後端都可以用

import type { FinanceLookups } from './transactions'

export type AccountOption = { id: number; label: string; currency: string | null }

// 分類選單:同類型、不含手續費;封存的只有 current 列出來。上層之後接它的子分類,子分類帶上層名稱
export function categoryOptions(lookups: FinanceLookups, type: 'expense' | 'income', current?: number): AccountOption[] {
  const usable = lookups.accounts.filter(
    (a) => a.type === type && a.id !== lookups.system.fee && (a.isActive || a.id === current),
  )
  const names = new Map(lookups.accounts.map((a) => [a.id, a.name]))
  const tops = usable.filter((a) => a.parentId === null)
  const children = usable.filter((a) => a.parentId !== null)
  const options: AccountOption[] = tops.flatMap((top) => [
    { id: top.id, label: top.name, currency: null },
    ...children
      .filter((c) => c.parentId === top.id)
      .map((c) => ({ id: c.id, label: `${top.name} / ${c.name}`, currency: null })),
  ])
  // 上層本身不能選(封存、或不是同類型)的子分類放最後
  for (const child of children) {
    if (!options.some((o) => o.id === child.id)) {
      options.push({ id: child.id, label: `${names.get(child.parentId ?? 0) ?? ''} / ${child.name}`, currency: null })
    }
  }
  return options
}

// 資產與負債帳戶(錢實際進出的地方),使用中的,依名稱排序;標上幣別
export function balanceAccountOptions(lookups: FinanceLookups): AccountOption[] {
  return lookups.accounts
    .filter((a) => (a.type === 'asset' || a.type === 'liability') && a.isActive)
    .map((a) => ({ id: a.id, label: `${a.name}(${a.currency ?? '?'})`, currency: a.currency }))
    .sort((a, b) => a.label.localeCompare(b.label))
}
