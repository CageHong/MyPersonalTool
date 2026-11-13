import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import SortIcon from './SortIcon'
import {
  DEFAULT_DIRECTION,
  DIRECTION_LABELS,
  GROUP_BY_OPTIONS,
  SORT_BY_OPTIONS,
  SORT_DIRECTION_VALUES,
  type ViewSettings,
} from '@/lib/listView'
import styles from './ViewSettingsMenu.module.css'

// 目前清單的分組與排序。只吃設定值,不認得是哪個清單;存到哪裡由 ThreeColumnLayout 決定
type Props = {
  settings: ViewSettings
  onChange: (next: ViewSettings) => void
}

export default function ViewSettingsMenu({ settings, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const idPrefix = useId()

  // 點外面就關;做法同 PriorityMenu(listener 只在開啟時掛,判斷對象含觸發鈕)
  useEffect(() => {
    if (!open) {
      return
    }

    function handlePointerDown(event: PointerEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [open])

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape' && open) {
      setOpen(false)
      triggerRef.current?.focus()
    }
  }

  // 選到目前的值不送出。選完不關:分組、排序、順序常常連著調,關掉要再開兩次
  function change(next: ViewSettings) {
    if (
      next.groupBy !== settings.groupBy ||
      next.sortBy !== settings.sortBy ||
      next.sortDirection !== settings.sortDirection
    ) {
      onChange(next)
    }
  }

  const groupLabel = GROUP_BY_OPTIONS.find((option) => option.value === settings.groupBy)?.label
  const sortLabel = SORT_BY_OPTIONS.find((option) => option.value === settings.sortBy)?.label

  return (
    <div className={styles.wrapper} ref={wrapperRef} onKeyDown={handleKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`分組與排序:分組 ${groupLabel},排序 ${sortLabel}`}
      >
        <SortIcon />
      </button>

      {open && (
        <div className={styles.menu} role="menu" aria-label="分組與排序">
          <div className={styles.group} role="group" aria-labelledby={`${idPrefix}-group`}>
            <span className={styles.heading} id={`${idPrefix}-group`}>
              分組
            </span>
            {GROUP_BY_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={styles.option}
                role="menuitemradio"
                aria-checked={option.value === settings.groupBy}
                onClick={() => change({ ...settings, groupBy: option.value })}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className={styles.group} role="group" aria-labelledby={`${idPrefix}-sort`}>
            <span className={styles.heading} id={`${idPrefix}-sort`}>
              排序
            </span>
            {SORT_BY_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={styles.option}
                role="menuitemradio"
                aria-checked={option.value === settings.sortBy}
                // 換欄位時方向回到那個欄位的起始方向:從「標題 Z → A」換到優先級,不該變成低的在前
                onClick={() =>
                  change({
                    ...settings,
                    sortBy: option.value,
                    sortDirection: DEFAULT_DIRECTION[option.value],
                  })
                }
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className={styles.group} role="group" aria-labelledby={`${idPrefix}-direction`}>
            <span className={styles.heading} id={`${idPrefix}-direction`}>
              順序
            </span>
            {SORT_DIRECTION_VALUES.map((direction) => (
              <button
                key={direction}
                type="button"
                className={styles.option}
                role="menuitemradio"
                aria-checked={direction === settings.sortDirection}
                onClick={() => change({ ...settings, sortDirection: direction })}
              >
                {DIRECTION_LABELS[settings.sortBy][direction]}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
