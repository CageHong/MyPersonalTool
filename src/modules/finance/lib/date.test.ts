import assert from 'node:assert/strict'
import { test } from 'node:test'
import { matchPreset, presetRange } from './date'

test('期間快捷:本月、上月、今年給完整期間;過去 30 天含今天', () => {
  assert.deepEqual(presetRange('thisMonth', '2026-11-15'), { from: '2026-11-01', to: '2026-11-30' })
  assert.deepEqual(presetRange('lastMonth', '2026-11-15'), { from: '2026-10-01', to: '2026-10-31' })
  assert.deepEqual(presetRange('thisYear', '2026-11-15'), { from: '2026-01-01', to: '2026-12-31' })
  assert.deepEqual(presetRange('last30', '2026-11-15'), { from: '2026-10-17', to: '2026-11-15' })
})

test('期間快捷:跨年、閏年二月', () => {
  assert.deepEqual(presetRange('lastMonth', '2026-01-10'), { from: '2025-12-01', to: '2025-12-31' })
  assert.deepEqual(presetRange('thisMonth', '2028-02-03'), { from: '2028-02-01', to: '2028-02-29' })
  assert.deepEqual(presetRange('last30', '2026-03-01'), { from: '2026-01-31', to: '2026-03-01' })
})

test('目前的範圍對應的快捷', () => {
  assert.equal(matchPreset(undefined, undefined, '2026-11-15'), 'all')
  assert.equal(matchPreset('2026-11-01', '2026-11-30', '2026-11-15'), 'thisMonth')
  assert.equal(matchPreset('2026-10-17', '2026-11-15', '2026-11-15'), 'last30')
  assert.equal(matchPreset('2026-11-01', undefined, '2026-11-15'), 'custom')
  assert.equal(matchPreset('2026-11-02', '2026-11-30', '2026-11-15'), 'custom')
})
