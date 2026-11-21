import type { ReactNode } from 'react'
import TopBar from './TopBar'
import styles from './AppShell.module.css'

export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className={styles.shell}>
      <TopBar />
      <div className={styles.content}>{children}</div>
    </div>
  )
}
