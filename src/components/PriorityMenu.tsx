import { Flag } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { PRIORITY_OPTIONS, priorityLevel } from '@/lib/tasks'
import styles from './PriorityMenu.module.css'

// 只吃數字,不認得 task
type Props = {
  value: number
  onSelect: (priority: number) => void
  disabled: boolean
}

export default function PriorityMenu({ value, onSelect, disabled }: Props) {
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

  function handleSelect(priority: number) {
    onSelect(priority)
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
  const triggerClass =
    level === undefined ? styles.trigger : `${styles.trigger} ${styles[level.tone]}`

  return (
    <div className={styles.wrapper} ref={wrapperRef} onKeyDown={handleKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClass}
        onClick={() => setOpen((current) => !current)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`優先級:${level?.label ?? '無'}`}
      >
        <Flag size={16} aria-hidden />
      </button>

      {open && (
        <div className={styles.menu} role="menu">
          {PRIORITY_OPTIONS.map((option) => {
            const tone = priorityLevel(option.value)?.tone
            const className = tone === undefined ? styles.option : `${styles.option} ${styles[tone]}`

            return (
              <button
                key={option.value}
                type="button"
                className={className}
                role="menuitemradio"
                aria-checked={option.value === value}
                onClick={() => handleSelect(option.value)}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
