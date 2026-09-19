import type { KeyboardEvent, MouseEvent } from 'react'
import { circleModel, countAriaLabel, type CircleDelta } from '@/lib/habitView'
import type { PeriodType } from '@/lib/habit'
import styles from './HabitCircles.module.css'

// 習慣視圖與中欄小區塊共用。只負責畫與回報「要走一步」,算新值、送出、樂觀更新都在 ThreeColumnLayout
type Props = {
  name: string
  periodType: PeriodType
  count: number
  target: number | null
  onStep: (delta: 1 | -1) => void
}

// 點圈圈有自己的意思,不順便選取所在的列(同任務列的勾選框)
function stopSelect(event: MouseEvent) {
  event.stopPropagation()
}

export default function HabitCircles({ name, periodType, count, target, onStep }: Props) {
  const model = circleModel(count, target)
  const label = countAriaLabel(name, periodType, count, target)

  // 紀錄型:次數加 +,沒有退回
  if (model.mode === 'record') {
    return (
      <span className={styles.numbers} onClick={stopSelect}>
        <span className={styles.count}>{model.count} 次</span>
        <button type="button" className={styles.stepButton} onClick={() => onStep(1)} aria-label={`${label},記一次`}>
          +
        </button>
      </span>
    )
  }

  // 目標超過圈圈上限:數字加 −/+。count 0 時 − 什麼都不做;不用 disabled(寫入期間不停用控制項的同一個理由:
  // 焦點會掉到 body),以 aria-disabled 告知並拿掉 pointer
  if (model.mode === 'number') {
    const canUndo = model.count > 0
    return (
      <span className={styles.numbers} onClick={stopSelect}>
        <button
          type="button"
          className={styles.stepButton}
          onClick={() => {
            if (canUndo) {
              onStep(-1)
            }
          }}
          aria-disabled={!canUndo || undefined}
          aria-label={`${label},退回一次`}
        >
          −
        </button>
        <span className={styles.count}>
          {model.count}/{model.target}
        </span>
        <button type="button" className={styles.stepButton} onClick={() => onStep(1)} aria-label={`${label},記一次`}>
          +
        </button>
      </span>
    )
  }

  // 圈圈:整排一個 tab stop,圈圈本身不可聚焦(內部不需要移動焦點)。
  // 圈圈是 span 不是 button:button 聚焦後按空白鍵會同時觸發它自己與整排的動作
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault()
      onStep(1)
    } else if (event.key === 'ArrowLeft' || event.key === '-') {
      event.preventDefault()
      if (count > 0) {
        onStep(-1)
      }
    }
  }

  function clickable(delta: CircleDelta) {
    return delta === null ? undefined : () => onStep(delta)
  }

  return (
    <div
      role="group"
      tabIndex={0}
      aria-label={label}
      className={styles.group}
      onKeyDown={handleKeyDown}
      onClick={stopSelect}
    >
      {model.mode === 'circles' &&
        model.circles.map((circle, index) => (
          <span
            key={index}
            // pending 沒有自己的 class:沿用 .circle 的淡框
            className={`${styles.circle} ${styles[circle.state] ?? ''} ${circle.delta === null ? '' : styles.clickable}`}
            onClick={clickable(circle.delta)}
          />
        ))}

      {model.mode === 'full' && (
        <>
          {/* 滿額收合:大勾。沒有超額時點了退一步、展開回圈圈;有超額時不可點,要從右邊一顆一顆退 */}
          <span
            className={`${styles.check} ${model.checkDelta === null ? '' : styles.clickable}`}
            onClick={clickable(model.checkDelta)}
            // 不用 disabled(同 target > 6 的 −):aria-disabled 加上沒有 pointer
            aria-disabled={model.checkDelta === null || undefined}
          />
          {model.overflowAs === 'circles' ? (
            Array.from({ length: model.overflow }, (_, index) => (
              <span
                key={index}
                className={`${styles.circle} ${styles.overflow} ${index === model.overflow - 1 ? styles.clickable : ''}`}
                onClick={index === model.overflow - 1 ? () => onStep(-1) : undefined}
              />
            ))
          ) : (
            // 超額超過三顆:+N,點它退一步(同最後一顆超額圈圈)
            <span className={`${styles.overflowCount} ${styles.clickable}`} onClick={() => onStep(-1)}>
              +{model.overflow}
            </span>
          )}
          {/* 小圈圈:超額 +1 */}
          <span className={`${styles.circle} ${styles.small} ${styles.clickable}`} onClick={() => onStep(1)} />
          {model.ratio !== null && <span className={styles.ratio}>{model.ratio}</span>}
        </>
      )}
    </div>
  )
}
