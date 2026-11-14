// 必須是第一個 import:在 db 連線建立前切到記憶體資料庫
import '../test/setup'
import assert from 'node:assert/strict'
import { before, describe, test } from 'node:test'
import { applyMigrations, db } from '../db'
import type { ViewSettings } from '../lib/listView'
import { ValidationError } from './errors'
import { listViewSettings, saveViewSettings } from './listViews'

before(() => {
  assert.equal(process.env.TASKS_DB_PATH, ':memory:')
  applyMigrations(db)
})

const SETTINGS: ViewSettings = { groupBy: 'priority', sortBy: 'dueDate', sortDirection: 'asc' }

function fieldsOf(fn: () => unknown): Record<string, string> {
  try {
    fn()
  } catch (error) {
    assert.ok(error instanceof ValidationError)
    return error.fields
  }
  assert.fail('expected ValidationError')
}

describe('saveViewSettings', () => {
  test('nothing is stored until a list is saved', () => {
    assert.deepEqual(listViewSettings(), [])
  })

  test('saving creates the row, saving again replaces it', () => {
    saveViewSettings('open', SETTINGS)
    saveViewSettings('open', { groupBy: 'none', sortBy: 'title', sortDirection: 'desc' })

    const rows = listViewSettings()
    assert.equal(rows.length, 1)
    assert.deepEqual(
      { ...rows[0], updatedAt: undefined },
      {
        listKey: 'open',
        groupBy: 'none',
        sortBy: 'title',
        sortDirection: 'desc',
        updatedAt: undefined,
      },
    )
  })

  test('each list keeps its own settings', () => {
    saveViewSettings('today', SETTINGS)
    const byKey = new Map(listViewSettings().map((row) => [row.listKey, row.groupBy]))
    assert.equal(byKey.get('today'), 'priority')
    assert.equal(byKey.get('open'), 'none')
  })

  test('rejects unknown lists, including the habits view', () => {
    assert.deepEqual(fieldsOf(() => saveViewSettings('habits', SETTINGS)), {
      listKey: 'invalid_value',
    })
    assert.deepEqual(fieldsOf(() => saveViewSettings('nope', SETTINGS)), {
      listKey: 'invalid_value',
    })
  })

  test('rejects values outside the allowed sets and reports every field', () => {
    const bad = { groupBy: 'tag', sortBy: 'id', sortDirection: 'up' } as unknown as ViewSettings
    assert.deepEqual(fieldsOf(() => saveViewSettings('open', bad)), {
      groupBy: 'invalid_value',
      sortBy: 'invalid_value',
      sortDirection: 'invalid_value',
    })
  })

  test('rejects a body with missing fields', () => {
    const partial = { groupBy: 'none' } as unknown as ViewSettings
    assert.deepEqual(fieldsOf(() => saveViewSettings('open', partial)), {
      sortBy: 'invalid_value',
      sortDirection: 'invalid_value',
    })
  })
})
