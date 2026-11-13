import styles from './TaskListSkeleton.module.css'

// 中欄清單的佔位橫條。PageSkeleton(伺服器端的首屏)與 TaskList(GET 進行中)共用同一份,
// 兩邊看到的是同一個東西,載入完成只切換一次畫面。
// 內容全部寫死:不讀時間、不讀網址、不用亂數,伺服器端與瀏覽器端產生的 HTML 一定相同
export default function TaskListSkeleton() {
  return (
    <div className={styles.skeleton} role="status" aria-label="載入中">
      <div className={styles.bar} aria-hidden />
      <div className={styles.bar} aria-hidden />
      <div className={styles.bar} aria-hidden />
    </div>
  )
}
