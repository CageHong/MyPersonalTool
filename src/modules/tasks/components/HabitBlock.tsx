import { useEffect, useLayoutEffect, useRef, useState, type TransitionEvent } from 'react'
import HabitCircles from './HabitCircles'
import { progressLabel, type HabitItem } from '@/modules/tasks/lib/habitView'
import styles from './HabitBlock.module.css'

// 中欄「今天」與「全部未完成」上方的習慣小區塊:本週期還沒滿額的習慣。
// 停止中與紀錄型不列、也不算進總數(紀錄型永遠不滿額,會固定掛著;decisions §6b)
type Props = {
  // 計數已套上樂觀覆寫值
  habits: HabitItem[]
  onStep: (habit: HabitItem, delta: 1 | -1) => void
}

// 滿額後先顯示大勾這麼久再離場:剛按下的那一下要看得到結果
const FULL_HOLD_MS = 400

// 收合狀態;今天與全部未完成兩個視圖共用這一個 key
const COLLAPSED_KEY = 'tasks:habit-block-collapsed'

// hold = 顯示大勾中;exiting = 淡出並收起高度中
type Lingering = ReadonlyMap<number, 'hold' | 'exiting'>

function isFull(habit: HabitItem): boolean {
  return habit.target !== null && habit.progress.count >= habit.target
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

// 焦點在離場的那一列裡時,先移到遞補的列:下一列 → 上一列 → 標題的收合鈕。
// 要在這一列變成 inert 之前移,否則焦點會掉到 body。使用者已經把焦點移走就不動
function moveFocusOff(list: HTMLElement | null, toggle: HTMLElement | null, id: number) {
  const active = document.activeElement
  const row = list?.querySelector<HTMLElement>(`li[data-habit-row="${id}"]`)
  if (list === null || !row || !(active instanceof HTMLElement) || !row.contains(active)) {
    return
  }
  const rows = Array.from(list.querySelectorAll<HTMLElement>('li[data-habit-row]:not([data-exiting])'))
  const index = rows.indexOf(row)
  const fallback = rows[index + 1] ?? rows[index - 1]
  const target = fallback?.querySelector<HTMLElement>('[role="group"], button')
  ;(target ?? toggle)?.focus()
}

function fullKey(habits: HabitItem[]): string {
  return habits
    .filter(isFull)
    .map((habit) => habit.id)
    .join(',')
}

export default function HabitBlock({ habits, onStep }: Props) {
  const eligible = habits.filter((habit) => !habit.paused && habit.target !== null)
  const filledCount = eligible.filter(isFull).length

  // 第一次 render 一律展開:伺服器端沒有 localStorage,在 render 時讀會 hydration 不一致
  const [collapsed, setCollapsed] = useState(false)
  useEffect(() => {
    try {
      // 外部儲存在掛載後同步一次,之後由使用者切換。刻意在 effect 裡讀:伺服器端沒有這個值,
      // render 時讀會 hydration 不一致;這裡多一次 render 是預期的
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCollapsed(window.localStorage.getItem(COLLAPSED_KEY) === '1')
    } catch {
      // 無痕模式或封鎖網站資料時讀不到:維持展開
    }
  }, [])

  function toggleCollapsed() {
    const next = !collapsed
    setCollapsed(next)
    try {
      window.localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0')
    } catch {
      // 存不了就只在這次瀏覽有效
    }
  }

  // 剛滿額的列先留著顯示大勾,再離場。「prop 變了就調整 state」的寫法(同 TaskList):
  // 在 render 中比對上一次的滿額集合。掛載當下已經滿額的不播(首次載入、切換視圖回來)
  const [lingering, setLingering] = useState<Lingering>(new Map())
  const [previous, setPrevious] = useState(() => ({ key: fullKey(eligible), ids: new Set(eligible.filter(isFull).map((h) => h.id)) }))
  const key = fullKey(eligible)
  if (key !== previous.key) {
    const fullIds = new Set(eligible.filter(isFull).map((habit) => habit.id))
    const next = new Map(lingering)
    for (const id of fullIds) {
      if (!previous.ids.has(id)) {
        next.set(id, 'hold')
      }
    }
    // 等待中又退回未滿額(點了大勾):取消離場,它本來就該列著
    for (const id of next.keys()) {
      if (!fullIds.has(id)) {
        next.delete(id)
      }
    }
    setLingering(next)
    setPrevious({ key, ids: fullIds })
  }

  const listRef = useRef<HTMLUListElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const timersRef = useRef(new Map<number, number>())

  // 等待結束:減少動態時直接移除;否則變成退場列,收完高度後由 transitionend 移除
  useEffect(() => {
    const timers = timersRef.current
    for (const [id, phase] of lingering) {
      if (phase !== 'hold' || timers.has(id)) {
        continue
      }
      const timer = window.setTimeout(() => {
        timers.delete(id)
        moveFocusOff(listRef.current, toggleRef.current, id)
        setLingering((current) => {
          if (current.get(id) !== 'hold') {
            return current
          }
          const next = new Map(current)
          if (prefersReducedMotion()) {
            next.delete(id)
          } else {
            next.set(id, 'exiting')
          }
          return next
        })
      }, FULL_HOLD_MS)
      timers.set(id, timer)
    }
    // 已經不在等待中的(退回未滿額)把計時器清掉
    for (const [id, timer] of timers) {
      if (lingering.get(id) !== 'hold') {
        window.clearTimeout(timer)
        timers.delete(id)
      }
    }
  }, [lingering])

  useEffect(() => {
    const timers = timersRef.current
    return () => {
      for (const timer of timers.values()) {
        window.clearTimeout(timer)
      }
      timers.clear()
    }
  }, [])

  // 收起高度要從實際高度開始(同 TaskList):先寫成行內樣式、強制排版,再改成 0
  useLayoutEffect(() => {
    const list = listRef.current
    if (list === null) {
      return
    }
    for (const row of list.querySelectorAll<HTMLElement>('li[data-exiting]:not([data-collapsing])')) {
      row.style.height = `${row.getBoundingClientRect().height}px`
      void row.offsetHeight
      row.dataset.collapsing = ''
      row.style.height = '0px'
    }
  }, [lingering])

  function handleExited(event: TransitionEvent<HTMLLIElement>, id: number) {
    if (event.target === event.currentTarget && event.propertyName === 'height') {
      setLingering((current) => {
        const next = new Map(current)
        next.delete(id)
        return next
      })
    }
  }

  // 一個進行中、有目標的習慣都沒有(全新資料庫、只有紀錄型)才整個不出現
  if (eligible.length === 0) {
    return null
  }

  const rows = eligible.filter((habit) => !isFull(habit) || lingering.has(habit.id))

  return (
    <section className={styles.block} aria-label="習慣">
      <button
        ref={toggleRef}
        type="button"
        className={styles.toggle}
        onClick={toggleCollapsed}
        aria-expanded={!collapsed}
      >
        <span className={styles.chevron} aria-hidden="true">
          {collapsed ? '▸' : '▾'}
        </span>
        {/* 收合後標題帶摘要:已滿額/總數 */}
        {collapsed ? `習慣 ${filledCount}/${eligible.length}` : '習慣'}
      </button>

      {!collapsed &&
        (rows.length === 0 ? (
          // 全部滿額是今天的成果:保留標題列,不讓區塊直接消失
          <p className={styles.done}>本週期的習慣都完成了</p>
        ) : (
          <ul ref={listRef} className={styles.list}>
            {rows.map((habit) => {
              const exiting = lingering.get(habit.id) === 'exiting'
              return (
                // 退場列 inert:焦點落不到它身上;不帶 data-task-id,任務的焦點遞補也看不到
                <li
                  key={habit.id}
                  className={exiting ? `${styles.item} ${styles.exiting}` : styles.item}
                  data-habit-row={habit.id}
                  data-exiting={exiting ? '' : undefined}
                  inert={exiting}
                  aria-hidden={exiting || undefined}
                  onTransitionEnd={exiting ? (event) => handleExited(event, habit.id) : undefined}
                >
                  <span className={styles.name}>{habit.name}</span>
                  <div className={styles.meta}>
                    <span className={styles.progress}>
                      {progressLabel(habit.periodType, habit.progress.count, habit.target)}
                    </span>
                    <HabitCircles
                      name={habit.name}
                      periodType={habit.periodType}
                      count={habit.progress.count}
                      target={habit.target}
                      onStep={(delta) => onStep(habit, delta)}
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        ))}
    </section>
  )
}
