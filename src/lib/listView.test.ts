import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  arrangeTasks,
  defaultSettings,
  settingsFor,
  type Section,
  type ViewSettings,
} from './listView'
import type { Task } from './tasks'

// 2026-09-16 是星期三;一週從週一開始,本週最後一天是 9/20(日)
const TODAY = '2026-09-16'

let nextId = 1

function makeTask(overrides: Partial<Task> = {}): Task {
  const id = nextId++
  return {
    id,
    title: `task ${id}`,
    notes: null,
    dueDate: null,
    priority: 0,
    completedAt: null,
    createdAt: id,
    pinned: false,
    recurrenceRuleId: null,
    occurrenceDate: null,
    ...overrides,
  }
}

const BASE: ViewSettings = { groupBy: 'none', sortBy: 'created', sortDirection: 'asc' }

function shape(sections: Section[]) {
  return sections.map((section) => [section.label, section.tasks.map((task) => task.id)])
}

describe('arrangeTasks sorting', () => {
  test('created: by createdAt, ties broken by id; desc reverses', () => {
    const a = makeTask({ createdAt: 5 })
    const b = makeTask({ createdAt: 5 })
    const c = makeTask({ createdAt: 1 })
    assert.deepEqual(shape(arrangeTasks([b, a, c], BASE, TODAY)), [[null, [c.id, a.id, b.id]]])
    assert.deepEqual(
      shape(arrangeTasks([b, a, c], { ...BASE, sortDirection: 'desc' }, TODAY)),
      [[null, [b.id, a.id, c.id]]],
    )
  })

  test('dueDate: no date sinks in both directions', () => {
    const none = makeTask()
    const late = makeTask({ dueDate: '2026-09-30' })
    const early = makeTask({ dueDate: '2026-09-10' })
    const asc = arrangeTasks([none, late, early], { ...BASE, sortBy: 'dueDate' }, TODAY)
    assert.deepEqual(shape(asc), [[null, [early.id, late.id, none.id]]])
    const desc = arrangeTasks(
      [none, late, early],
      { ...BASE, sortBy: 'dueDate', sortDirection: 'desc' },
      TODAY,
    )
    assert.deepEqual(shape(desc), [[null, [late.id, early.id, none.id]]])
  })

  test('dueDate: same date falls back to created order regardless of direction', () => {
    const first = makeTask({ dueDate: '2026-09-20' })
    const second = makeTask({ dueDate: '2026-09-20' })
    const desc = arrangeTasks(
      [second, first],
      { ...BASE, sortBy: 'dueDate', sortDirection: 'desc' },
      TODAY,
    )
    assert.deepEqual(shape(desc), [[null, [first.id, second.id]]])
  })

  test('priority: no priority sinks in both directions', () => {
    const none = makeTask()
    const low = makeTask({ priority: 1 })
    const high = makeTask({ priority: 5 })
    const desc = arrangeTasks(
      [none, low, high],
      { ...BASE, sortBy: 'priority', sortDirection: 'desc' },
      TODAY,
    )
    assert.deepEqual(shape(desc), [[null, [high.id, low.id, none.id]]])
    const asc = arrangeTasks([none, low, high], { ...BASE, sortBy: 'priority' }, TODAY)
    assert.deepEqual(shape(asc), [[null, [low.id, high.id, none.id]]])
  })

  test('title: natural order, numbers compared as numbers', () => {
    const ten = makeTask({ title: '第 10 章' })
    const two = makeTask({ title: '第 2 章' })
    const sorted = arrangeTasks([ten, two], { ...BASE, sortBy: 'title' }, TODAY)
    assert.deepEqual(shape(sorted), [[null, [two.id, ten.id]]])
  })

  test('does not mutate the input array', () => {
    const a = makeTask({ createdAt: 9 })
    const b = makeTask({ createdAt: 1 })
    const input = [a, b]
    arrangeTasks(input, BASE, TODAY)
    assert.deepEqual(input, [a, b])
  })
})

describe('arrangeTasks grouping', () => {
  test('no tasks gives no sections', () => {
    assert.deepEqual(arrangeTasks([], BASE, TODAY), [])
    assert.deepEqual(arrangeTasks([], { ...BASE, groupBy: 'date' }, TODAY), [])
  })

  test('date buckets in fixed order, empty buckets omitted', () => {
    const noDate = makeTask()
    const later = makeTask({ dueDate: '2026-09-21' })
    const thisWeek = makeTask({ dueDate: '2026-09-20' })
    const tomorrow = makeTask({ dueDate: '2026-09-17' })
    const today = makeTask({ dueDate: TODAY })
    const overdue = makeTask({ dueDate: '2026-09-15' })
    const sections = arrangeTasks(
      [noDate, later, thisWeek, tomorrow, today, overdue],
      { ...BASE, groupBy: 'date' },
      TODAY,
    )
    assert.deepEqual(shape(sections), [
      ['逾期', [overdue.id]],
      ['今天', [today.id]],
      ['明天', [tomorrow.id]],
      ['本週', [thisWeek.id]],
      ['更晚', [later.id]],
      ['無日期', [noDate.id]],
    ])
  })

  test('on the last day of the week, tomorrow is still 明天 and next week is 更晚', () => {
    const sunday = '2026-09-20'
    const tomorrow = makeTask({ dueDate: '2026-09-21' })
    const nextWeek = makeTask({ dueDate: '2026-09-22' })
    const sections = arrangeTasks([tomorrow, nextWeek], { ...BASE, groupBy: 'date' }, sunday)
    assert.deepEqual(shape(sections), [
      ['明天', [tomorrow.id]],
      ['更晚', [nextWeek.id]],
    ])
  })

  test('priority buckets high to low, none last; sort applies inside each bucket', () => {
    const none = makeTask()
    const highLate = makeTask({ priority: 5, dueDate: '2026-09-30' })
    const highEarly = makeTask({ priority: 5, dueDate: '2026-09-10' })
    const low = makeTask({ priority: 1 })
    const sections = arrangeTasks(
      [none, highLate, highEarly, low],
      { groupBy: 'priority', sortBy: 'dueDate', sortDirection: 'asc' },
      TODAY,
    )
    assert.deepEqual(shape(sections), [
      ['高', [highEarly.id, highLate.id]],
      ['低', [low.id]],
      ['無優先級', [none.id]],
    ])
  })
})

describe('arrangeTasks pinned', () => {
  test('pinned tasks leave their group; group contents exclude them', () => {
    const pinnedHigh = makeTask({ priority: 5, pinned: true })
    const high = makeTask({ priority: 5 })
    const pinnedNone = makeTask({ pinned: true })
    const sections = arrangeTasks(
      [pinnedHigh, high, pinnedNone],
      { ...BASE, groupBy: 'priority' },
      TODAY,
    )
    assert.deepEqual(shape(sections), [
      ['置頂', [pinnedHigh.id, pinnedNone.id]],
      ['高', [high.id]],
    ])
  })

  test('pinned section follows the current sort', () => {
    const late = makeTask({ pinned: true, dueDate: '2026-09-30' })
    const early = makeTask({ pinned: true, dueDate: '2026-09-10' })
    const sections = arrangeTasks([late, early], { ...BASE, sortBy: 'dueDate' }, TODAY)
    assert.deepEqual(shape(sections), [['置頂', [early.id, late.id]]])
  })

  test('without grouping, the rest gets a title once a pinned section exists', () => {
    const pinned = makeTask({ pinned: true })
    const other = makeTask()
    assert.deepEqual(shape(arrangeTasks([pinned, other], BASE, TODAY)), [
      ['置頂', [pinned.id]],
      ['其他', [other.id]],
    ])
  })

  test('completed pinned tasks stay in their group', () => {
    const done = makeTask({ pinned: true, completedAt: 100 })
    assert.deepEqual(shape(arrangeTasks([done], BASE, TODAY)), [[null, [done.id]]])
  })
})

describe('settingsFor', () => {
  test('stored settings win; missing lists use defaults', () => {
    const stored = [
      { listKey: 'open', groupBy: 'priority', sortBy: 'title', sortDirection: 'desc' } as const,
    ]
    assert.deepEqual(settingsFor(stored, 'open'), {
      groupBy: 'priority',
      sortBy: 'title',
      sortDirection: 'desc',
    })
    assert.deepEqual(settingsFor(stored, 'today'), defaultSettings('today'))
  })

  test('today and next7 group by date by default', () => {
    assert.equal(defaultSettings('today').groupBy, 'date')
    assert.equal(defaultSettings('next7').groupBy, 'date')
    assert.equal(defaultSettings('open').groupBy, 'none')
  })
})
