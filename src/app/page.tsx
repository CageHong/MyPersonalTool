import TaskList from '@/components/TaskList'
import styles from './page.module.css'

export default function Home() {
  return (
    <main className={styles.main}>
      <h1>tasks</h1>
      <TaskList />
    </main>
  )
}
