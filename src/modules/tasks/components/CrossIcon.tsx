import styles from './CrossIcon.module.css'

// 線條跟著外層文字色(currentColor)。純裝飾:按鈕的 aria-label 說明它做什麼
export default function CrossIcon() {
  return (
    <svg
      className={styles.icon}
      viewBox="0 0 16 16"
      strokeWidth={1.5}
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M4 4L12 12M12 4L4 12" />
    </svg>
  )
}
