import styles from './SortIcon.module.css'

// 三條由長到短的橫線。線條跟著外層文字色(currentColor)。
// 純裝飾:「分組與排序」的文字由外層的 aria-label 提供
export default function SortIcon() {
  return (
    <svg className={styles.icon} viewBox="0 0 16 16" strokeWidth={1.5} strokeLinecap="round" aria-hidden>
      <path d="M2.5 4H13.5M2.5 8H10.5M2.5 12H7.5" />
    </svg>
  )
}
