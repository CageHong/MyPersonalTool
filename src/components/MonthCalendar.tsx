import { useState } from 'react'
import { addMonths, monthDays, parseIso, todayIso, weekdayHeaders } from '@/lib/date'
import styles from './MonthCalendar.module.css'

type Props = {
  value: string | null
  onSelect: (iso: string) => void
  // 目前顯示的月份裡要淡色標示的日期(重複規則的預覽);翻月份時用新的範圍重算
  marked?: (first: string, last: string) => ReadonlySet<string>
}

function monthOf(iso: string) {
  const { year, month } = parseIso(iso)
  return { year, month }
}

export default function MonthCalendar({ value, onSelect, marked }: Props) {
  const today = todayIso()
  const [view, setView] = useState(() => monthOf(value ?? today))

  // value 跳到別的月份時(例如按了快捷鍵)月曆跟著翻頁;使用者自己翻月份不受影響
  const [lastValue, setLastValue] = useState(value)
  if (value !== lastValue) {
    setLastValue(value)
    if (value !== null) {
      setView(monthOf(value))
    }
  }

  const days = monthDays(view.year, view.month)
  const inMonth = days.filter((iso): iso is string => iso !== null)
  const markedDays = marked?.(inMonth[0], inMonth[inMonth.length - 1])

  return (
    <div className={styles.calendar}>
      <div className={styles.header}>
        <button
          type="button"
          className={styles.nav}
          onClick={() => setView(addMonths(view, -1))}
          aria-label="上個月"
        >
          ‹
        </button>
        <span className={styles.month}>
          {view.year} 年 {view.month} 月
        </span>
        <button
          type="button"
          className={styles.nav}
          onClick={() => setView(addMonths(view, 1))}
          aria-label="下個月"
        >
          ›
        </button>
      </div>

      <div className={styles.grid}>
        {weekdayHeaders().map((label) => (
          <span key={label} className={styles.weekday}>
            {label}
          </span>
        ))}

        {days.map((iso, index) =>
          iso === null ? (
            // 月初的空格,只是佔位
            <span key={`blank-${index}`} />
          ) : (
            <button
              key={iso}
              type="button"
              className={[
                styles.day,
                iso === today ? styles.today : '',
                iso === value ? styles.selected : '',
                markedDays?.has(iso) ? styles.marked : '',
              ]
                .filter((name) => name !== '')
                .join(' ')}
              onClick={() => onSelect(iso)}
              aria-pressed={iso === value}
            >
              {parseIso(iso).day}
            </button>
          ),
        )}
      </div>
    </div>
  )
}
