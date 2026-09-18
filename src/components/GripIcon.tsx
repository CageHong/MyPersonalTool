import styles from './GripIcon.module.css'

// 兩欄三列的點:零長度線段加圓頭端點畫成圓點,線條跟著外層文字色(currentColor)。
// 純裝飾:把手的 aria-label 說明它做什麼
export default function GripIcon() {
  return (
    <svg
      className={styles.icon}
      viewBox="0 0 16 16"
      strokeWidth={2.5}
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M6 3.5h0M10 3.5h0M6 8h0M10 8h0M6 12.5h0M10 12.5h0" />
    </svg>
  )
}
