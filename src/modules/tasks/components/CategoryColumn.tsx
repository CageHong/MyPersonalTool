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
        {VIEWS.map((item) => {
          const isCurrent = item.id === view
          // reminders 是底部群組的第一項,margin-top: auto 把提醒與其後的垃圾桶一起推到底部
          const isBottom = item.id === 'reminders'
          const className = [
            styles.view,
            isCurrent ? styles.current : '',
            isBottom ? styles.bottomView : '',
          ]
            .filter(Boolean)
            .join(' ')
          return (
            <button
              key={item.id}
              type="button"
              className={className}
              onClick={() => onSelect(item.id)}
              aria-current={isCurrent}
            >
              {item.label}
            </button>
          )
        })}
      </nav>

      <p className={styles.today}>{formatLongDate(today)}</p>
    </div>
  )
}
