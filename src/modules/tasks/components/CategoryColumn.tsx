import { formatLongDate } from '@/modules/tasks/lib/date'
import { VIEWS, type ViewId } from '@/modules/tasks/lib/views'
import styles from './CategoryColumn.module.css'

// 本輪的智慧檢視只有查詢條件,沒有自訂清單表
type Props = {
  view: ViewId
  onSelect: (view: ViewId) => void
  today: string
}

export default function CategoryColumn({ view, onSelect, today }: Props) {
  return (
    <div className={styles.column}>
      <nav className={styles.views}>
        {VIEWS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={item.id === view ? `${styles.view} ${styles.current}` : styles.view}
            onClick={() => onSelect(item.id)}
            aria-current={item.id === view}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <p className={styles.today}>{formatLongDate(today)}</p>
    </div>
  )
}
