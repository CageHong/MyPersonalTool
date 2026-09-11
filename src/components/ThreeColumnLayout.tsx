import styles from './ThreeColumnLayout.module.css'

// 本輪只做版面,三欄都是死的佔位文字;接資料是下一個切片
const VIEW_PLACEHOLDERS = ['今天', '未來 7 天', '全部未完成', '已完成']

// 夠多列才看得出中欄自己捲動
const TASK_PLACEHOLDERS = Array.from(
  { length: 30 },
  (_, i) => `任務佔位 ${i + 1}`,
)

export default function ThreeColumnLayout() {
  return (
    <div className={styles.layout}>
      <section className={`${styles.column} ${styles.categories}`}>
        <h2 className={styles.columnTitle}>分類</h2>
        <div className={styles.placeholder}>
          {VIEW_PLACEHOLDERS.map((view) => (
            <span key={view}>{view}</span>
          ))}
        </div>
      </section>

      <section className={`${styles.column} ${styles.tasks}`}>
        <h2 className={styles.columnTitle}>任務</h2>
        <div className={styles.placeholder}>
          {TASK_PLACEHOLDERS.map((task) => (
            <span key={task}>{task}</span>
          ))}
        </div>
      </section>

      <section className={`${styles.column} ${styles.detail}`}>
        <h2 className={styles.columnTitle}>編輯</h2>
        <div className={styles.placeholder}>
          <span>未選取任務</span>
        </div>
      </section>
    </div>
  )
}
