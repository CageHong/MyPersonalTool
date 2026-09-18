import { priorityLevel } from '@/lib/tasks'
import styles from './FlagIcon.module.css'

type Props = {
  priority: number
}

// 無優先級 = 空心旗,低/中/高 = 實心旗;顏色全在 CSS,這裡只挑 class。
// 純裝飾:優先級的文字由外層的標籤或 aria-label 提供
export default function FlagIcon({ priority }: Props) {
  const tone = priorityLevel(priority)?.tone

  return (
    <svg
      className={tone === undefined ? styles.icon : `${styles.icon} ${styles[tone]}`}
      viewBox="0 0 16 16"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path className={styles.flag} d="M3.5 2.5H12.5L10.5 5.5L12.5 8.5H3.5Z" />
      <path className={styles.pole} d="M3.5 1.5V14.5" />
    </svg>
  )
}
