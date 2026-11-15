import assert from 'node:assert/strict'
import { test } from 'node:test'
import { NotFoundError as FinanceNotFound, ValidationError as FinanceValidation } from '@/modules/finance/server/errors'
import { NotFoundError as TasksNotFound, ValidationError as TasksValidation } from '@/modules/tasks/server/errors'
import { handleError } from './http'

// 每個工具的錯誤類別都要對映到同一套狀態碼(只認平台的基底,不認哪個工具)
for (const [tool, Validation, NotFound] of [
  ['tasks', TasksValidation, (id: number) => new TasksNotFound(id)],
  ['finance', FinanceValidation, (id: number) => new FinanceNotFound('Thing', id)],
] as const) {
  test(`${tool} 的驗證錯誤回 400,帶 fields`, async () => {
    const response = handleError('test', new Validation({ name: 'required' }), 'missing')
    assert.equal(response.status, 400)
    const body = await response.json()
    assert.deepEqual(body, {
      error: { code: 'VALIDATION_FAILED', message: 'Validation failed', fields: { name: 'required' } },
    })
  })

  test(`${tool} 的找不到回 404`, async () => {
    const response = handleError('test', NotFound(7), 'Thing not found')
    assert.equal(response.status, 404)
    assert.equal((await response.json()).error.code, 'NOT_FOUND')
  })
}

test('其他錯誤回 500', async () => {
  const original = console.error
  console.error = () => {}
  try {
    const response = handleError('test', new Error('boom'), 'missing')
    assert.equal(response.status, 500)
  } finally {
    console.error = original
  }
})
