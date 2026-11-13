import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import FlagIcon from './FlagIcon'
import { PRIORITY_OPTIONS, priorityLevel } from '@/modules/tasks/lib/tasks'
import styles from './PriorityMenu.module.css'

// 只吃數字,不認得 task;新增列與右欄共用
type Props = {
  value: number
  onSelect: (priority: number) => void
  // 右欄要讀得出目前狀態,觸發鈕顯示「旗 + 值」;新增列空值是預設,只放旗子
  showValue: boolean
}

export default function PriorityMenu({ value, onSelect, showValue }: Props) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  // 點外面就關。判斷的對象是整個包裝層(含觸發鈕):點觸發鈕時這裡什麼都不做,
  // 交給它自己的 onClick toggle,才不會關了又被開起來。
  // listener 只在開啟時掛,所以開啟用的那次 pointerdown 不會自己把選單關掉。
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

  // 選到目前的值不呼叫 onSelect:右欄是點選即存,沒變化就不該送 PATCH
  function handleSelect(priority: number) {
    if (priority !== value) {
      onSelect(priority)
    }
    setOpen(false)
    triggerRef.current?.focus()
  }

  // 選單內按 Esc 也會冒泡到這裡
  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape' && open) {
      setOpen(false)
      triggerRef.current?.focus()
    }
  }

  const level = priorityLevel(value)
  const label = level?.label ?? '無'

  return (
    <div className={styles.wrapper} ref={wrapperRef} onKeyDown={handleKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`優先級:${label}`}
      >
        <FlagIcon priority={value} />
        {showValue && <span className={level === undefined ? styles.empty : undefined}>{label}</span>}
      </button>

      {open && (
        <div className={styles.menu} role="menu">
          {PRIORITY_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={styles.option}
              role="menuitemradio"
              aria-checked={option.value === value}
              onClick={() => handleSelect(option.value)}
            >
              <FlagIcon priority={option.value} />
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
