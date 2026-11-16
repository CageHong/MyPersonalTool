import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getOverview } from './overview'
import { reportFixture } from './testing'

test('總覽:本月與上月以 today 的月份切;近 12 個月含本月', () => {
  const o = getOverview(reportFixture(), '2026-02-15')
  assert.deepEqual([o.thisMonth.from, o.thisMonth.to], ['2026-02-01', '2026-02-28'])
  assert.deepEqual([o.lastMonth.from, o.lastMonth.to], ['2026-01-01', '2026-01-31'])
  // 二月:Rent 500 + Food 40;一月:Rent 500 + Phone 12.34 + Old phone 9 + Food 25
  assert.equal(o.thisMonth.summary.expense.total, 54000)
  assert.equal(o.lastMonth.summary.expense.total, 54634)
  assert.equal(o.recent.months.length, 12)
  assert.equal(o.recent.months.at(-1)?.month, '2026-02')
  assert.equal(o.lastTransactionDate, '2026-02-02')
})

test('總覽:本月固定支出列出每月一次的啟用項目(已扣 / 未扣);跨年的上月', () => {
  const o = getOverview(reportFixture(), '2026-02-15')
  assert.deepEqual(o.scheduled.map((i) => [i.name, i.count]), [['Rent', 1], ['Phone', 0]])
  assert.deepEqual([getOverview(reportFixture(), '2026-01-03').lastMonth.from], ['2025-12-01'])
})

test('總覽:進行中的旅行優先,否則最近開始的一趟;未分類筆數', () => {
  assert.deepEqual(
    (({ name, ongoing }) => ({ name, ongoing }))(getOverview(reportFixture(), '2026-02-02').trip!),
    { name: 'Trip B', ongoing: true },
  )
  assert.deepEqual(
    (({ name, ongoing }) => ({ name, ongoing }))(getOverview(reportFixture(), '2026-01-20').trip!),
    { name: 'Trip A', ongoing: false },
  )
  assert.equal(getOverview(reportFixture(), '2026-02-15').uncategorized, 0)
})
