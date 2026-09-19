import styles from './RepeatIcon.module.css'

// 兩個首尾相接的箭頭。線條跟著外層文字色(currentColor)。
// 純裝飾:「重複」的文字由外層的 aria-label 提供
export default function RepeatIcon() {
  return (
    <svg
      className={styles.icon}
      viewBox="0 0 16 16"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2.5 7.5V6.5A2 2 0 0 1 4.5 4.5H13.5M11 2L13.5 4.5L11 7" />
      <path d="M13.5 8.5V9.5A2 2 0 0 1 11.5 11.5H2.5M5 14L2.5 11.5L5 9" />
    </svg>
  )
}
