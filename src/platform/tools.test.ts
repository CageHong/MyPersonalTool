import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { findToolByPathname, isValidToolUrl, resolveToolHref, TOOLS, toolLastUrlKey } from './tools'

describe('platform/tools', () => {
  it('matches pathname to tool or returns null for home and unknown paths', () => {
    assert.equal(findToolByPathname('/'), null)
    assert.equal(findToolByPathname('/tasks')?.id, 'tasks')
    assert.equal(findToolByPathname('/tasks/sub')?.id, 'tasks')
    assert.equal(findToolByPathname('/finance')?.id, 'finance')
    assert.equal(findToolByPathname('/finance/transactions')?.id, 'finance')
    assert.equal(findToolByPathname('/tasks-other'), null)
  })

  it('validates and resolves stored tool URLs safely', () => {
    const tasks = TOOLS[0]
    assert.equal(isValidToolUrl(tasks, '/tasks'), true)
    assert.equal(isValidToolUrl(tasks, '/tasks?view=habits'), true)
    assert.equal(isValidToolUrl(tasks, '/tasks/123'), true)
    assert.equal(isValidToolUrl(tasks, '/finance'), false)
    assert.equal(isValidToolUrl(tasks, 'https://example.com'), false)
    assert.equal(isValidToolUrl(tasks, '/tasks-other'), false)

    assert.equal(resolveToolHref(tasks, '/tasks?view=habits'), '/tasks?view=habits')
    assert.equal(resolveToolHref(tasks, '/finance'), '/tasks')
    assert.equal(resolveToolHref(tasks, null), '/tasks')
    assert.equal(toolLastUrlKey('tasks'), 'personal-tools:last-url:tasks')
  })
})
