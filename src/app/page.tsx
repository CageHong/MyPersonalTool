import Link from 'next/link'
import styles from './page.module.css'

type ToolEntry = {
  href: '/tasks' | '/finance'
  name: string
  description: string
}

const TOOLS: readonly ToolEntry[] = [
  {
    href: '/tasks',
    name: '任務',
    description: '待辦、重複任務、習慣',
  },
  {
    href: '/finance',
    name: 'finance',
    description: '複式簿記記帳',
  },
]

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
