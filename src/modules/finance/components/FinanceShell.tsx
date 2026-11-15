'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import styles from './FinanceShell.module.css'

// finance 各頁共用的版面:左側欄(標題 + 導覽)、右邊是頁面內容。
// 導覽只列已經做好的頁面
const NAV = [
  { href: '/finance/transactions', label: '交易' },
  { href: '/finance/import', label: '匯入' },
] as const

export default function FinanceShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  return (
    <div className={styles.layout}>
      <aside className={styles.sidebar}>
        <p className={styles.title}>finance</p>
        <nav className={styles.nav} aria-label="finance">
          {NAV.map((item) => {
            const current = pathname === item.href || pathname.startsWith(`${item.href}/`)
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
          })}
        </nav>
      </aside>
      <main className={styles.main}>{children}</main>
    </div>
  )
}
