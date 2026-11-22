'use client'

import { useRef, type PointerEvent } from 'react'
import styles from './ResizeHandle.module.css'

type Props = {
  side: 'left' | 'right'
  ariaLabel: string
  onResizeStart: (side: 'left' | 'right', clientX: number) => void
  onResizeMove: (side: 'left' | 'right', clientX: number) => void
  onResizeEnd: (side: 'left' | 'right', clientX: number) => void
}

// 欄寬拖拉把手：只處理滑鼠 Pointer Events，不進 Tab 順序
export default function ResizeHandle({
  side,
  ariaLabel,
  onResizeStart,
  onResizeMove,
  onResizeEnd,
}: Props) {
  const activePointerId = useRef<number | null>(null)

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== 'mouse' || event.button !== 0) {
      return
    }
    event.preventDefault()
    activePointerId.current = event.pointerId
    event.currentTarget.setPointerCapture(event.pointerId)
    onResizeStart(side, event.clientX)
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (activePointerId.current !== event.pointerId) {
      return
    }
    onResizeMove(side, event.clientX)
  }

  function finishDrag(event: PointerEvent<HTMLDivElement>) {
    if (activePointerId.current !== event.pointerId) {
      return
    }
    activePointerId.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    onResizeEnd(side, event.clientX)
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      className={styles.handle}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
    />
  )
}
