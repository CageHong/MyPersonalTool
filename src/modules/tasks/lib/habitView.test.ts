import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { circleModel, countOf, stepCounts, type CircleModel } from './habitView'

const TODAY = '2026-09-19'

function circlesOf(model: CircleModel) {
  assert.equal(model.mode, 'circles')
  return model.mode === 'circles' ? model.circles : []
}

function fullOf(model: CircleModel) {
  assert.equal(model.mode, 'full')
  if (model.mode !== 'full') {
    throw new Error('not full')
  }
  return model
}

describe('circleModel', () => {
  test('done / next / pending by count, not by position', () => {
    assert.deepEqual(
      circlesOf(circleModel(2, 4)).map((circle) => circle.state),
      ['done', 'done', 'next', 'pending'],
    )
    assert.deepEqual(
      circlesOf(circleModel(0, 4)).map((circle) => circle.state),
      ['next', 'pending', 'pending', 'pending'],
    )
  })

  test('only the count+1-th (+1) and count-th (-1) circles are clickable', () => {
    assert.deepEqual(
      circlesOf(circleModel(2, 4)).map((circle) => circle.delta),
      [null, -1, 1, null],
    )
    // count 0:沒有可以退的
    assert.deepEqual(
      circlesOf(circleModel(0, 3)).map((circle) => circle.delta),
      [1, null, null],
    )
  })

  test('reaching the target collapses into the big check, which steps back once', () => {
    const full = fullOf(circleModel(4, 4))
    assert.equal(full.checkDelta, -1)
    assert.equal(full.overflow, 0)
    assert.equal(full.ratio, null)
  })

  test('with overflow the big check is not clickable', () => {
    for (const count of [5, 8]) {
      const full = fullOf(circleModel(count, 4))
      assert.equal(full.checkDelta, null, `count ${count}`)
    }
  })

  test('up to three overflow circles, then +N; ratio shown only with overflow', () => {
    assert.deepEqual(
      [5, 6, 7].map((count) => fullOf(circleModel(count, 4)).overflowAs),
      ['circles', 'circles', 'circles'],
    )
    const many = fullOf(circleModel(8, 4))
    assert.equal(many.overflowAs, 'number')
    assert.equal(many.overflow, 4)
    assert.equal(fullOf(circleModel(6, 4)).ratio, '6/4')
  })

  test('targets above six fall back to numbers', () => {
    assert.deepEqual(circleModel(3, 10), { mode: 'number', count: 3, target: 10 })
    assert.equal(circleModel(0, 6).mode, 'circles')
  })

  test('record-only habits have just a count', () => {
    assert.deepEqual(circleModel(5, null), { mode: 'record', count: 5 })
  })
})

describe('stepCounts', () => {
  test('+1 always lands on today', () => {
    const empty = stepCounts([], TODAY, 1)
    assert.deepEqual(empty.periodCounts, [{ date: TODAY, count: 1 }])
    assert.deepEqual(empty.writes, [{ date: TODAY, count: 1 }])

    // 本週稍早有紀錄,+1 仍記在今天,放在最前面
    const earlier = stepCounts([{ date: '2026-09-14', count: 2 }], TODAY, 1)
    assert.deepEqual(earlier.periodCounts, [
      { date: TODAY, count: 1 },
      { date: '2026-09-14', count: 2 },
    ])
    assert.deepEqual(earlier.writes, [{ date: TODAY, count: 1 }])

    const again = stepCounts(earlier.periodCounts, TODAY, 1)
    assert.deepEqual(again.writes, [{ date: TODAY, count: 2 }])
  })

  test('-1 works on the most recent date; a date that reaches zero disappears', () => {
    let counts = [
      { date: '2026-09-16', count: 1 },
      { date: '2026-09-14', count: 2 },
    ]

    let step = stepCounts(counts, TODAY, -1)
    assert.deepEqual(step.writes, [{ date: '2026-09-16', count: 0 }])
    assert.deepEqual(step.periodCounts, [{ date: '2026-09-14', count: 2 }])
    counts = step.periodCounts

    step = stepCounts(counts, TODAY, -1)
    assert.deepEqual(step.writes, [{ date: '2026-09-14', count: 1 }])
    counts = step.periodCounts

    step = stepCounts(counts, TODAY, -1)
    assert.deepEqual(step.writes, [{ date: '2026-09-14', count: 0 }])
    assert.deepEqual(step.periodCounts, [])

    // 沒有紀錄可退:什麼都不送
    assert.deepEqual(stepCounts([], TODAY, -1), { periodCounts: [], writes: [] })
  })

  test('multiple steps across dates send one final value per date', () => {
    const step = stepCounts(
      [
        { date: '2026-09-16', count: 1 },
        { date: '2026-09-14', count: 3 },
      ],
      TODAY,
      -3,
    )
    assert.deepEqual(step.writes, [
      { date: '2026-09-16', count: 0 },
      { date: '2026-09-14', count: 1 },
    ])
    assert.equal(countOf(step.periodCounts), 1)
  })

  test('does not mutate its input', () => {
    const counts = [{ date: TODAY, count: 1 }]
    stepCounts(counts, TODAY, 1)
    assert.deepEqual(counts, [{ date: TODAY, count: 1 }])
  })
})
