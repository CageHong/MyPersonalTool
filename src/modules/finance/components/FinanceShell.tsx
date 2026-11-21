'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { SidebarAccounts, SidebarWorth, useNetWorth } from './SidebarAccounts'
import styles from './FinanceShell.module.css'

// finance 各頁共用的版面:左側欄由上到下是欄頭(標題、淨資產、可動用資金)、主導覽、帳戶清單(可收合)、管理;
// 右邊是頁面內容。導覽只列已經做好的頁面
const NAV = [
  { href: '/finance', label: '總覽' },
  { href: '/finance/transactions', label: '交易' },
  { href: '/finance/reports', label: '報表' },
  { href: '/finance/scheduled', label: '固定支出' },
  { href: '/finance/trips', label: '旅行' },
  { href: '/finance/import', label: '匯入' },
] as const

// 管理:分類、收款人、規則、標籤、帳戶
const ADMIN_NAV = [
  { href: '/finance/categories', label: '分類' },
  { href: '/finance/payees', label: '收款人' },
  { href: '/finance/rules', label: '規則' },
  { href: '/finance/tags', label: '標籤' },
  { href: '/finance/accounts', label: '帳戶' },
] as const

export default function FinanceShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const worth = useNetWorth()
  const link = (item: { href: string; label: string }) => {
    // 總覽(/finance)只有自己那一頁算目前的頁面,不然所有 finance 頁都會被標成總覽
    const current = pathname === item.href || (item.href !== '/finance' && pathname.startsWith(`${item.href}/`))
    return (
      <Link
        key={item.href}
        href={item.href}
        className={current ? `${styles.link} ${styles.current}` : styles.link}
        aria-current={current ? 'page' : undefined}
      >
        {item.label}
      </Link>
    )
  }
  return (
    <div className={styles.layout}>
      <aside className={styles.sidebar}>
        <header className={styles.top}>
          <SidebarWorth data={worth.data} />
        </header>
        <nav className={styles.nav} aria-label="finance">
          {NAV.map(link)}
        </nav>
        <SidebarAccounts data={worth.data} error={worth.error} onRetry={worth.retry} />
        <nav className={styles.nav} aria-label="管理">
          <span className={styles.group}>管理</span>
          {ADMIN_NAV.map(link)}
        </nav>
      </aside>
      <main className={styles.main}>{children}</main>
    </div>
  )
}
