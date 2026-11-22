import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { looksEdited, type LegacyInstance, type LegacyRule } from './missedInstances'

const rule: LegacyRule = {
  title: 'water plants',
  notes: 'balcony',
  priority: 1,
  createdAt: 1000,
  template: ['fill can', 'water'],
}

// 照範本產生、沒被動過的實例
function pristine(overrides: Partial<LegacyInstance> = {}): LegacyInstance {
  return {
    title: 'water plants',
    notes: 'balcony',
    priority: 1,
    dueDate: '2026-09-10',
    occurrenceDate: '2026-09-10',
    createdAt: 2000,
    checklist: [
      { title: 'fill can', completedAt: null },
      { title: 'water', completedAt: null },
    ],
    ...overrides,
  }
}

describe('looksEdited', () => {
  test('an instance identical to the template is not edited', () => {
    assert.equal(looksEdited(pristine(), rule), false)
  })

  test('an instance of a rule without notes or checklist is not edited', () => {
    const bare: LegacyRule = { ...rule, notes: null, template: [] }
    assert.equal(looksEdited(pristine({ notes: null, checklist: [] }), bare), false)
  })

  const changes: Array<[string, Partial<LegacyInstance>]> = [
    ['title', { title: 'water plants (late)' }],
    ['notes', { notes: 'balcony and kitchen' }],
    ['notes cleared', { notes: null }],
    ['priority', { priority: 5 }],
    ['moved date', { dueDate: '2026-09-11' }],
    ['date cleared', { dueDate: null }],
    ['checklist item added', {
      checklist: [
        { title: 'fill can', completedAt: null },
        { title: 'water', completedAt: null },
        { title: 'extra', completedAt: null },
      ],
    }],
    ['checklist item removed', { checklist: [{ title: 'fill can', completedAt: null }] }],
    ['checklist item renamed', {
      checklist: [
        { title: 'fill can', completedAt: null },
        { title: 'water well', completedAt: null },
      ],
    }],
    ['checklist reordered', {
      checklist: [
        { title: 'water', completedAt: null },
        { title: 'fill can', completedAt: null },
      ],
    }],
    ['checklist item ticked', {
      checklist: [
        { title: 'fill can', completedAt: 3000 },
        { title: 'water', completedAt: null },
      ],
    }],
    ['original task of the rule', { createdAt: 500 }],
  ]
  for (const [name, overrides] of changes) {
    test(`counts as edited: ${name}`, () => {
      assert.equal(looksEdited(pristine(overrides), rule), true)
    })
  }
})
