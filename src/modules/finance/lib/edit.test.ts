import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseTransactionPatch } from './edit'

const AT = '2030-01-01T00:00:00+00:00'

test('合法的 patch 原樣解析;沒給的欄位不出現', () => {
  assert.deepEqual(parseTransactionPatch({ expectedUpdatedAt: AT }), { ok: true, patch: { expectedUpdatedAt: AT } })
  const full = {
    expectedUpdatedAt: AT,
    occurredAt: '2030-01-02T03:04:05Z',
    note: null,
    payee: { name: 'Corner Shop' },
    categories: [{ postingId: 1, accountId: 2 }],
    tags: { ids: [3], newNames: ['Trip'] },
  }
  assert.deepEqual(parseTransactionPatch(full), { ok: true, patch: full })
  assert.deepEqual(parseTransactionPatch({ expectedUpdatedAt: AT, payee: { id: 4 } }), {
    ok: true,
    patch: { expectedUpdatedAt: AT, payee: { id: 4 } },
  })
  assert.deepEqual(parseTransactionPatch({ expectedUpdatedAt: AT, payee: null }), {
    ok: true,
    patch: { expectedUpdatedAt: AT, payee: null },
  })
})

test('型別不對、缺 expectedUpdatedAt、不認得的欄位', () => {
  assert.deepEqual(parseTransactionPatch([]), { ok: false, fields: { body: 'invalid' } })
  assert.deepEqual(parseTransactionPatch({}), { ok: false, fields: { expectedUpdatedAt: 'required' } })
  const bad = parseTransactionPatch({
    expectedUpdatedAt: AT,
    occurredAt: 5,
    note: 1,
    payee: { id: 1, name: 'x' },
    categories: [{ postingId: 1.5, accountId: 2 }],
    tags: { ids: ['1'], newNames: [] },
    amount: 100,
  })
  assert.deepEqual(bad, {
    ok: false,
    fields: { occurredAt: 'invalid', note: 'invalid', payee: 'invalid', categories: 'invalid', tags: 'invalid', amount: 'unknown' },
  })
})
