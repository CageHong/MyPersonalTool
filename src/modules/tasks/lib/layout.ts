export const MIN_LEFT_WIDTH = 180
export const MIN_MIDDLE_WIDTH = 360
export const MIN_RIGHT_WIDTH = 320

export const DEFAULT_LEFT_WIDTH = 240
export const DEFAULT_RIGHT_WIDTH = 320

export const LAYOUT_STORAGE_KEY = 'tasks:layout'

export type StoredLayout = {
  leftWidth: number
  rightWidth: number
  leftCollapsed: boolean
  rightCollapsed: boolean
}

export const DEFAULT_LAYOUT: StoredLayout = {
  leftWidth: DEFAULT_LEFT_WIDTH,
  rightWidth: DEFAULT_RIGHT_WIDTH,
  leftCollapsed: false,
  rightCollapsed: false,
}

export type ResolvedLayout = {
  leftWidth: number
  rightWidth: number
  leftCollapsed: boolean
  rightCollapsed: boolean
  autoLeftCollapsed: boolean
  autoRightCollapsed: boolean
}

function normalizeWidth(value: unknown, min: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }
  return Math.max(min, Math.round(value))
}

export function parseStoredLayout(raw: string | null): StoredLayout {
  if (raw === null) {
    return DEFAULT_LAYOUT
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return DEFAULT_LAYOUT
    }
    const obj = parsed as Record<string, unknown>
    return {
      leftWidth: normalizeWidth(obj.leftWidth, MIN_LEFT_WIDTH, DEFAULT_LEFT_WIDTH),
      rightWidth: normalizeWidth(obj.rightWidth, MIN_RIGHT_WIDTH, DEFAULT_RIGHT_WIDTH),
      leftCollapsed: typeof obj.leftCollapsed === 'boolean' ? obj.leftCollapsed : false,
      rightCollapsed: typeof obj.rightCollapsed === 'boolean' ? obj.rightCollapsed : false,
    }
  } catch {
    return DEFAULT_LAYOUT
  }
}

export function clampDragWidth(
  side: 'left' | 'right',
  rawWidth: number,
  containerWidth: number,
  otherWidth: number,
  otherCollapsed: boolean,
): number {
  const min = side === 'left' ? MIN_LEFT_WIDTH : MIN_RIGHT_WIDTH
  const otherUsed = otherCollapsed ? 0 : otherWidth
  const max = Math.max(min, containerWidth - MIN_MIDDLE_WIDTH - otherUsed)
  return Math.round(Math.min(max, Math.max(min, rawWidth)))
}

// 拖拉放開時要存的版面:拖的那一側存成拖到的寬度,另一側存成它目前畫面上的寬度。
// 只改拖的那一側的話,另一側存的仍是被縮小前的寬度,resolveLayout 會再等比例縮一次,
// 放開後拖的那一側會往回跳。clampDragWidth 已保證兩者加起來放得下。收合中的那一側不動
export function applyDragWidth(
  stored: StoredLayout,
  effective: ResolvedLayout,
  side: 'left' | 'right',
  width: number,
): StoredLayout {
  if (side === 'left') {
    return {
      ...stored,
      leftWidth: width,
      rightWidth: effective.rightCollapsed ? stored.rightWidth : effective.rightWidth,
    }
  }
  return {
    ...stored,
    rightWidth: width,
    leftWidth: effective.leftCollapsed ? stored.leftWidth : effective.leftWidth,
  }
}

// 依視窗寬度與最小寬度決定實際欄寬與自動收合狀態：
// 1. 先縮中欄到 MIN_MIDDLE_WIDTH
// 2. 再依左右欄超出各自最小寬度的比例縮減側欄
// 3. 都到底仍放不下時，先自動收起右欄（改為抽屜）、再收起左欄
export function resolveLayout(containerWidth: number | null, stored: StoredLayout): ResolvedLayout {
  if (containerWidth === null || containerWidth <= 0) {
    return {
      leftWidth: stored.leftWidth,
      rightWidth: stored.rightWidth,
      leftCollapsed: stored.leftCollapsed,
      rightCollapsed: stored.rightCollapsed,
      autoLeftCollapsed: false,
      autoRightCollapsed: false,
    }
  }

  let leftCollapsed = stored.leftCollapsed
  let rightCollapsed = stored.rightCollapsed
  let autoLeftCollapsed = false
  let autoRightCollapsed = false

  const minWithRight = (leftCollapsed ? 0 : MIN_LEFT_WIDTH) + MIN_MIDDLE_WIDTH + MIN_RIGHT_WIDTH
  if (!rightCollapsed && containerWidth < minWithRight) {
    rightCollapsed = true
    autoRightCollapsed = true
  }

  const minWithLeft = MIN_LEFT_WIDTH + MIN_MIDDLE_WIDTH
  if (!leftCollapsed && containerWidth < minWithLeft) {
    leftCollapsed = true
    autoLeftCollapsed = true
  }

  const available = Math.max(0, containerWidth - MIN_MIDDLE_WIDTH)
  let leftWidth = stored.leftWidth
  let rightWidth = stored.rightWidth

  if (!leftCollapsed && !rightCollapsed) {
    const desired = stored.leftWidth + stored.rightWidth
    if (desired > available) {
      const deficit = desired - available
      const leftExcess = Math.max(0, stored.leftWidth - MIN_LEFT_WIDTH)
      const rightExcess = Math.max(0, stored.rightWidth - MIN_RIGHT_WIDTH)
      const totalExcess = leftExcess + rightExcess
      if (totalExcess <= 0) {
        leftWidth = MIN_LEFT_WIDTH
        rightWidth = MIN_RIGHT_WIDTH
      } else {
        let leftCut = Math.min(leftExcess, Math.round((deficit * leftExcess) / totalExcess))
        const rightCut = Math.min(rightExcess, deficit - leftCut)
        if (leftCut + rightCut < deficit) {
          leftCut = Math.min(leftExcess, deficit - rightCut)
        }
        leftWidth = stored.leftWidth - leftCut
        rightWidth = stored.rightWidth - rightCut
      }
    }
  } else if (!leftCollapsed) {
    leftWidth = Math.max(MIN_LEFT_WIDTH, Math.min(stored.leftWidth, available))
  } else if (!rightCollapsed) {
    rightWidth = Math.max(MIN_RIGHT_WIDTH, Math.min(stored.rightWidth, available))
  }

  return {
    leftWidth,
    rightWidth,
    leftCollapsed,
    rightCollapsed,
    autoLeftCollapsed,
    autoRightCollapsed,
  }
}
