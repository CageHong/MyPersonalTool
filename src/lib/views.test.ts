import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { Task } from './tasks'
import { collapseRecurring, filterTasks } from './views'

const TODAY = '2026-09-18'

let nextId = 1

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: nextId++,
    title: 'task',
    notes: null,
    dueDate: null,
    priority: 0,
    completedAt: null,
    recurrenceRuleId: null,
    occurrenceDate: null,
    ...overrides,
  }
}

// 規則產生的實例:截止日與 occurrenceDate 相同(除非之後被改)
function instance(ruleId: number, date: string, overrides: Partial<Task> = {}): Task {
  return makeTask({ recurrenceRuleId: ruleId, dueDate: date, occurrenceDate: date, ...overrides })
}

function ids(tasks: Task[]): number[] {
  return tasks.map((task) => task.id)
}

describe('collapseRecurring', () => {
  test('keeps only the earliest of three incomplete instances', () => {
    const a = instance(1, '2026-09-18')
    const b = instance(1, '2026-09-19')
    const c = instance(1, '2026-09-20')

    const result = collapseRecurring([a, b, c], TODAY)

    assert.deepEqual(ids(result.tasks), [a.id])
  })

  test('moving the representative later hands over to another instance', () => {
    // 9/18 的實例被延到 9/25:9/19 變成代表
    const moved = instance(1, '2026-09-18', { dueDate: '2026-09-25' })
    const b = instance(1, '2026-09-19')
    const c = instance(1, '2026-09-20')

    const result = collapseRecurring([moved, b, c], TODAY)

    assert.deepEqual(ids(result.tasks), [b.id])
  })

  test('ties on dueDate fall back to occurrenceDate, then id', () => {
    const later = instance(1, '2026-09-20', { dueDate: '2026-09-19' })
    const earlier = instance(1, '2026-09-19')

    assert.deepEqual(ids(collapseRecurring([later, earlier], TODAY).tasks), [earlier.id])
  })

  test('an instance without a dueDate does not win', () => {
    const cleared = instance(1, '2026-09-17', { dueDate: null })
    const dated = instance(1, '2026-09-19')

    assert.deepEqual(ids(collapseRecurring([cleared, dated], TODAY).tasks), [dated.id])
  })

  test('counts the other overdue instances on the representative', () => {
    const a = instance(1, '2026-09-16')
    const b = instance(1, '2026-09-17')
    const c = instance(1, '2026-09-18')

    const result = collapseRecurring([a, b, c], TODAY)

    assert.deepEqual(ids(result.tasks), [a.id])
    // 9/17 逾期;9/18 是今天,不算
    assert.equal(result.overdueCounts.get(a.id), 1)
  })

  test('completed instances are records and are not collapsed', () => {
    const done1 = instance(1, '2026-09-16', { completedAt: 1 })
    const done2 = instance(1, '2026-09-17', { completedAt: 2 })
    const open = instance(1, '2026-09-18')

    const result = collapseRecurring([done1, done2, open], TODAY)

    assert.deepEqual(ids(result.tasks), [done1.id, done2.id, open.id])
    // 已完成的不算逾期
    assert.equal(result.overdueCounts.get(open.id), undefined)
  })

  test('rules are independent; plain tasks stay; input order is kept', () => {
    const plain1 = makeTask({ dueDate: '2026-09-30' })
    const r1Late = instance(1, '2026-09-19')
    const r2 = instance(2, '2026-09-20')
    const plain2 = makeTask()
    const r1Early = instance(1, '2026-09-18')
    const r2Late = instance(2, '2026-09-21')

    const result = collapseRecurring([plain1, r1Late, r2, plain2, r1Early, r2Late], TODAY)

    assert.deepEqual(ids(result.tasks), [plain1.id, r2.id, plain2.id, r1Early.id])
  })
})

describe('filterTasks collapses before filtering by date', () => {
  test('today view shows the overdue 9/17, not 9/18; no extra overdue count', () => {
    const yesterday = instance(1, '2026-09-17')
    const today = instance(1, '2026-09-18')

    const result = filterTasks([yesterday, today], 'today', TODAY)

    assert.deepEqual(ids(result.tasks), [yesterday.id])
    assert.equal(result.overdueCounts.get(yesterday.id), undefined)
  })

  test('every list view shows one row per rule', () => {
    const tasks = ['2026-09-18', '2026-09-19', '2026-09-20'].map((date) => instance(1, date))

    for (const view of ['today', 'next7', 'open'] as const) {
      assert.deepEqual(ids(filterTasks(tasks, view, TODAY).tasks), [tasks[0].id], view)
    }
  })
})
