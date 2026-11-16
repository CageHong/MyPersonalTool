'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { getJson, loadErrorMessage } from '../lib/api'
import { onLedgerChanged } from '../lib/ledger-events'
import { formatMoney } from '../lib/money'
import type { NetWorth, SidebarGroup } from '../lib/net-worth'
import { transactionsHref } from '../lib/transactions'
import styles from './SidebarAccounts.module.css'

// 側欄的淨資產、可動用資金與帳戶清單(唯讀)。換頁或帳本改了(ledger-events)就重新取。
// 帳戶清單可以收合:整個區塊一個開關,每個群組各一個;預設群組收合、只看合計。展開狀態存 localStorage

const URL = '/api/finance/reports/net-worth'
const STATE_KEY = 'finance.sidebar.accounts'

type Collapse = { open: boolean; groups: string[] }
const DEFAULT_COLLAPSE: Collapse = { open: true, groups: [] }

function groupKey(group: SidebarGroup): string {
  return group.id === null ? 'none' : String(group.id)
}

function readCollapse(): Collapse {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(STATE_KEY) ?? 'null')
    if (
      value !== null &&
      typeof value === 'object' &&
      typeof (value as Collapse).open === 'boolean' &&
      Array.isArray((value as Collapse).groups)
    ) {
      return { open: (value as Collapse).open, groups: (value as Collapse).groups.filter((g) => typeof g === 'string') }
    }
  } catch {
    // 讀不到或格式不對:用預設
  }
  return DEFAULT_COLLAPSE
}

// 淨資產;換頁或帳本改了就重新取
export function useNetWorth(): { data: NetWorth | null; error: string | null; retry: () => void } {
  const pathname = usePathname()
  const [data, setData] = useState<NetWorth | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => onLedgerChanged(() => setAttempt((n) => n + 1)), [])

  useEffect(() => {
    const controller = new AbortController()
    getJson<NetWorth>(URL, controller.signal)
      .then((result) => {
        setData(result)
        setError(null)
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setError(loadErrorMessage(caught))
      })
    return () => controller.abort()
  }, [pathname, attempt])

  return { data, error, retry: () => setAttempt((n) => n + 1) }
}

// 欄頭:淨資產、可動用資金
export function SidebarWorth({ data }: { data: NetWorth | null }) {
  if (!data) return null
  const money = (amount: number) => formatMoney(amount, data.currency, data.exponents)
  return (
    <dl className={styles.worth}>
      <div>
        <dt>淨資產</dt>
        <dd className={styles.worthAmount}>{money(data.netWorth)}</dd>
      </div>
      <div>
        <dt>可動用資金</dt>
        <dd className={styles.amount}>{money(data.available)}</dd>
      </div>
      {data.missingRate > 0 && <dd className={styles.warning}>{data.missingRate} 個帳戶缺匯率,沒有算進去</dd>}
    </dl>
  )
}

type ListProps = { data: NetWorth | null; error: string | null; onRetry: () => void }

// 帳戶清單:群組(合計)→ 帳戶(原幣餘額);點帳戶 → 交易清單的帳戶篩選
export function SidebarAccounts({ data, error, onRetry }: ListProps) {
  const [collapse, setCollapse] = useState<Collapse>(DEFAULT_COLLAPSE)
  useEffect(() => {
    // 掛載後同步一次瀏覽器記住的狀態(伺服器端沒有 localStorage,render 時讀會 hydration 不一致)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCollapse(readCollapse())
  }, [])

  function update(next: Collapse) {
    setCollapse(next)
    try {
      window.localStorage.setItem(STATE_KEY, JSON.stringify(next))
    } catch {
      // 存不了就只在這次瀏覽有效
    }
  }
  function toggleGroup(key: string) {
    const groups = collapse.groups.includes(key) ? collapse.groups.filter((g) => g !== key) : [...collapse.groups, key]
    update({ ...collapse, groups })
  }

  return (
    <section className={styles.accounts} aria-label="帳戶">
      <button
        type="button"
        className={styles.heading}
        aria-expanded={collapse.open}
        onClick={() => update({ ...collapse, open: !collapse.open })}
      >
        <span className={styles.chevron} aria-hidden="true">
          {collapse.open ? '▾' : '▸'}
        </span>
        帳戶
      </button>
      {collapse.open && error && (
        <p className={styles.warning}>
          {error}{' '}
          <button type="button" className={styles.retry} onClick={onRetry}>
            重試
          </button>
        </p>
      )}
      {collapse.open && data && (
        <ul className={styles.groups}>
          {data.groups.map((group) => {
            const key = groupKey(group)
            const open = collapse.groups.includes(key)
            return (
              <li key={key}>
                <button type="button" className={styles.group} aria-expanded={open} onClick={() => toggleGroup(key)}>
                  <span className={styles.chevron} aria-hidden="true">
                    {open ? '▾' : '▸'}
                  </span>
                  <span className={styles.name}>{group.name}</span>
                  <span className={styles.amount}>
                    {group.total === null ? '—' : formatMoney(group.total, group.currency, data.exponents)}
                  </span>
                </button>
                {open && (
                  <ul className={styles.list}>
                    {group.accounts.map((account) => (
                      <li key={account.id}>
                        <Link
                          href={transactionsHref({ accountId: account.id })}
                          className={account.balance === 0 ? `${styles.account} ${styles.zero}` : styles.account}
                        >
                          <span className={styles.name}>
                            {account.name}
                            {account.isActive ? '' : '(已封存)'}
                          </span>
                          <span className={styles.amount}>
                            {formatMoney(account.balance, account.currency, data.exponents)}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
