import type { ReactNode } from 'react'
import HabitCircles from './HabitCircles'
import NewHabitForm from './NewHabitForm'
import TaskListSkeleton from './TaskListSkeleton'
import type { ApiError } from '@/modules/tasks/lib/errors'
import { progressLabel, streakLabel, type HabitItem } from '@/modules/tasks/lib/habitView'
import styles from './HabitList.module.css'

// 習慣視圖的中欄。資料與寫入都在 ThreeColumnLayout,這裡只負責畫
type Props = {
  // 計數已套上樂觀覆寫值
  habits: HabitItem[]
  loading: boolean
  error: string | null
  selectedId: number | null
  onSelect: (id: number) => void
  onCreate: (name: string) => Promise<ApiError | null>
  onStep: (habit: HabitItem, delta: 1 | -1) => void
  leftToggle?: ReactNode
  rightToggle?: ReactNode
}

export default function HabitList({
  habits,
  loading,
  error,
  selectedId,
  onSelect,
  onCreate,
  onStep,
  leftToggle,
  rightToggle,
}: Props) {
  // 進行中的(含已滿額)在上,停止中的在底部自成一區;兩區內都維持 API 的順序(sortOrder)
  const active = habits.filter((habit) => !habit.paused)
  const paused = habits.filter((habit) => habit.paused)

  function row(habit: HabitItem) {
    const selected = habit.id === selectedId
    return (
      // data-habit-id:刪除後 ThreeColumnLayout 靠它找遞補的列。沒有 data-task-id,任務的焦點遞補看不到它
      <li
        key={habit.id}
        className={selected ? `${styles.item} ${styles.selected}` : styles.item}
        onClick={() => onSelect(habit.id)}
        aria-current={selected}
        data-habit-id={habit.id}
      >
        <button type="button" className={styles.name} onClick={() => onSelect(habit.id)} data-habit-control="row">
          {habit.name}
        </button>

        {/* 進度與 streak 不縮;空間不足時只截名稱 */}
        <div className={styles.meta}>
          <span className={styles.progress}>
            {progressLabel(habit.periodType, habit.progress.count, habit.target)}
          </span>
          {/* 紀錄型沒有 streak */}
          {habit.target !== null && habit.streak !== null && (
            <span className={styles.streak}>{streakLabel(habit.periodType, habit.streak)}</span>
          )}
          {/* 停止中不能記錄(伺服器會拒絕),不畫圈圈 */}
          {!habit.paused && (
            <HabitCircles
              name={habit.name}
              periodType={habit.periodType}
              count={habit.progress.count}
              target={habit.target}
              onStep={(delta) => onStep(habit, delta)}
            />
          )}
        </div>
      </li>
    )
  }

  return (
    <div className={styles.container}>
      <header className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          {leftToggle}
          <h2 className={styles.viewTitle}>習慣</h2>
        </div>
        <div className={styles.toolbarRight}>{rightToggle}</div>
      </header>

      <NewHabitForm onCreate={onCreate} />

      {error !== null && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {loading && <TaskListSkeleton />}

      {!loading && error === null && habits.length === 0 && (
        <p className={styles.status}>還沒有習慣,從上方新增一個</p>
      )}

      {active.length > 0 && <ul className={styles.list}>{active.map(row)}</ul>}

      {paused.length > 0 && (
        <section className={styles.section} aria-labelledby="habits-paused-heading">
          <h2 id="habits-paused-heading" className={styles.heading}>
            已停止
          </h2>
          <ul className={styles.list}>{paused.map(row)}</ul>
        </section>
      )}
    </div>
  )
}
