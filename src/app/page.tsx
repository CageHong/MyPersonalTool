import Link from 'next/link'
import { TOOLS } from '@/platform/tools'
import styles from './page.module.css'

export default function Home() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>personal-tools</h1>
      </header>
      <nav aria-label="工具入口">
        <ul className={styles.list}>
          {TOOLS.map((tool) => (
            <li key={tool.href}>
              <Link href={tool.href} className={styles.card}>
                <span className={styles.name}>{tool.name}</span>
                <span className={styles.description}>{tool.description}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </main>
  )
}
