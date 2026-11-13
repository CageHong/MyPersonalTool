import styles from './CalendarIcon.module.css'

// 線條跟著外層文字色(currentColor):觸發鈕空值時淡色、逾期時紅色。
// 純裝飾:日期的文字由外層的 aria-label 提供
export default function CalendarIcon() {
  return (
    <svg
      className={styles.icon}
      viewBox="0 0 16 16"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="2" y="3" width="12" height="11" rx="1.5" />
      <path d="M2 6.5H14M5.5 1.5V4.5M10.5 1.5V4.5" />
    </svg>
  )
}
