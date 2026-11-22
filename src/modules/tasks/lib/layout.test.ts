import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DEFAULT_LAYOUT,
  DEFAULT_LEFT_WIDTH,
  DEFAULT_RIGHT_WIDTH,
  MIN_LEFT_WIDTH,
  MIN_MIDDLE_WIDTH,
  MIN_RIGHT_WIDTH,
  clampDragWidth,
  parseStoredLayout,
  resolveLayout,
  type StoredLayout,
} from './layout'

describe('parseStoredLayout', () => {
  it('returns default layout when raw is null or invalid JSON', () => {
    assert.deepEqual(parseStoredLayout(null), DEFAULT_LAYOUT)
    assert.deepEqual(parseStoredLayout('not json'), DEFAULT_LAYOUT)
    assert.deepEqual(parseStoredLayout('[]'), DEFAULT_LAYOUT)
  })

  it('clamps widths to minimum values and falls back invalid fields', () => {
    const parsed = parseStoredLayout(
      JSON.stringify({
        leftWidth: 100,
        rightWidth: 420.6,
        leftCollapsed: true,
        rightCollapsed: 'yes',
      }),
    )
    assert.deepEqual(parsed, {
      leftWidth: MIN_LEFT_WIDTH,
      rightWidth: 421,
      leftCollapsed: true,
      rightCollapsed: false,
    })
  })
})

describe('resolveLayout', () => {
  const wideUser: StoredLayout = {
    leftWidth: 260,
    rightWidth: 400,
    leftCollapsed: false,
    rightCollapsed: false,
  }

  it('keeps stored widths and collapsed state before measurement (null)', () => {
    const res = resolveLayout(null, wideUser)
    assert.deepEqual(res, {
      leftWidth: 260,
      rightWidth: 400,
      leftCollapsed: false,
      rightCollapsed: false,
      autoLeftCollapsed: false,
      autoRightCollapsed: false,
    })
  })

  it('keeps all three columns at stored widths when container is wide enough', () => {
    // 260 + 360 + 400 = 1020
    const res = resolveLayout(1200, wideUser)
    assert.deepEqual(res, {
      leftWidth: 260,
      rightWidth: 400,
      leftCollapsed: false,
      rightCollapsed: false,
      autoLeftCollapsed: false,
      autoRightCollapsed: false,
    })
  })

  it('shrinks middle column first down to MIN_MIDDLE_WIDTH before touching sidebars', () => {
    // 260 + 360 + 400 = 1020 -> middle shrinks from 440 to 360, sidebars untouched
    const res = resolveLayout(1020, wideUser)
    assert.equal(res.leftWidth, 260)
    assert.equal(res.rightWidth, 400)
    assert.equal(res.autoLeftCollapsed, false)
    assert.equal(res.autoRightCollapsed, false)
  })

  it('shrinks sidebars proportionally to their excess over minWidth once middle hits 360', () => {
    // left excess = 260 - 180 = 80; right excess = 400 - 320 = 80 (1:1)
    // container = 960 -> available for sidebars = 600 -> deficit = 660 - 600 = 60 -> 30 each
    const res = resolveLayout(960, wideUser)
    assert.equal(res.leftWidth, 230)
    assert.equal(res.rightWidth, 370)
    assert.equal(res.leftCollapsed, false)
    assert.equal(res.rightCollapsed, false)
    assert.equal(res.autoLeftCollapsed, false)
    assert.equal(res.autoRightCollapsed, false)
  })

  it('auto-collapses right column to drawer when container is below 860', () => {
    const minThreshold = MIN_LEFT_WIDTH + MIN_MIDDLE_WIDTH + MIN_RIGHT_WIDTH // 860
    const atThreshold = resolveLayout(minThreshold, wideUser)
    assert.equal(atThreshold.rightCollapsed, false)
    assert.equal(atThreshold.autoRightCollapsed, false)
    assert.equal(atThreshold.leftWidth, MIN_LEFT_WIDTH)
    assert.equal(atThreshold.rightWidth, MIN_RIGHT_WIDTH)

    const belowThreshold = resolveLayout(minThreshold - 1, wideUser)
    assert.equal(belowThreshold.rightCollapsed, true)
    assert.equal(belowThreshold.autoRightCollapsed, true)
    assert.equal(belowThreshold.leftCollapsed, false)
    assert.equal(belowThreshold.autoLeftCollapsed, false)
    // Left column gets its stored width back since right is now a drawer (859 - 360 = 499 >= 260)
    assert.equal(belowThreshold.leftWidth, 260)
  })

  it('auto-collapses left column as well when container is below 540', () => {
    const minLeftThreshold = MIN_LEFT_WIDTH + MIN_MIDDLE_WIDTH // 540
    const below = resolveLayout(minLeftThreshold - 1, wideUser)
    assert.equal(below.rightCollapsed, true)
    assert.equal(below.autoRightCollapsed, true)
    assert.equal(below.leftCollapsed, true)
    assert.equal(below.autoLeftCollapsed, true)
  })

  it('respects user manual collapse without setting auto-collapse flags', () => {
    const userLeftCollapsed: StoredLayout = {
      leftWidth: DEFAULT_LEFT_WIDTH,
      rightWidth: DEFAULT_RIGHT_WIDTH,
      leftCollapsed: true,
      rightCollapsed: false,
    }
    // 360 + 320 = 680 fits without left column
    const at680 = resolveLayout(680, userLeftCollapsed)
    assert.equal(at680.leftCollapsed, true)
    assert.equal(at680.autoLeftCollapsed, false)
    assert.equal(at680.rightCollapsed, false)
    assert.equal(at680.autoRightCollapsed, false)

    // Below 680 auto-collapses right, while left remains manual (autoLeftCollapsed = false)
    const at679 = resolveLayout(679, userLeftCollapsed)
    assert.equal(at679.leftCollapsed, true)
    assert.equal(at679.autoLeftCollapsed, false)
    assert.equal(at679.rightCollapsed, true)
    assert.equal(at679.autoRightCollapsed, true)
  })

  it('restores user settings when container widens back', () => {
    const narrow = resolveLayout(500, wideUser)
    assert.equal(narrow.leftCollapsed, true)
    assert.equal(narrow.rightCollapsed, true)

    const widened = resolveLayout(1200, wideUser)
    assert.deepEqual(widened, {
      leftWidth: 260,
      rightWidth: 400,
      leftCollapsed: false,
      rightCollapsed: false,
      autoLeftCollapsed: false,
      autoRightCollapsed: false,
    })
  })
})

describe('clampDragWidth', () => {
  it('clamps between min width and remaining space after MIN_MIDDLE_WIDTH', () => {
    // container 1000, right is 320 -> max left = 1000 - 360 - 320 = 320
    assert.equal(clampDragWidth('left', 100, 1000, 320, false), MIN_LEFT_WIDTH)
    assert.equal(clampDragWidth('left', 400, 1000, 320, false), 320)
    // when right is collapsed, max left = 1000 - 360 = 640
    assert.equal(clampDragWidth('left', 500, 1000, 320, true), 500)
  })
})
