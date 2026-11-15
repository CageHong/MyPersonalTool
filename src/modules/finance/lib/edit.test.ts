import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseNewTransaction, parseTransactionPatch } from './edit'

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

test('postings:整組替換的分錄;memo 可省略;不能跟 categories 一起給', () => {
  assert.deepEqual(
    parseTransactionPatch({ expectedUpdatedAt: AT, postings: [{ accountId: 1, amount: -100, currency: 'EUR' }, { accountId: 2, amount: 100, currency: 'EUR', memo: 'x' }] }),
    { ok: true, patch: { expectedUpdatedAt: AT, postings: [
      { accountId: 1, amount: -100, currency: 'EUR', memo: null },
      { accountId: 2, amount: 100, currency: 'EUR', memo: 'x' },
    ] } },
  )
  assert.deepEqual(parseTransactionPatch({ expectedUpdatedAt: AT, postings: [{ accountId: 1, amount: 1.5, currency: 'EUR' }] }), {
    ok: false, fields: { postings: 'invalid' },
  })
  assert.deepEqual(parseTransactionPatch({ expectedUpdatedAt: AT, postings: [], categories: [] }), {
    ok: false, fields: { categories: 'with_postings' },
  })
})

test('新增交易的請求:payee、note 可省略;缺時間、形狀不對、不認得的欄位', () => {
  const postings = [{ accountId: 1, amount: -100, currency: 'EUR' }, { accountId: 2, amount: 100, currency: 'EUR' }]
  assert.deepEqual(parseNewTransaction({ occurredAt: AT, postings }), {
    ok: true,
    input: { occurredAt: AT, payee: null, note: null, postings: postings.map((p) => ({ ...p, memo: null })) },
  })
  assert.deepEqual(parseNewTransaction({ occurredAt: AT, payee: { name: 'Shop' }, note: 'x', postings }).ok, true)
  assert.deepEqual(parseNewTransaction({ payee: 3, note: 5, postings: 'x', extra: 1 }), {
    ok: false,
    fields: { extra: 'unknown', occurredAt: 'required', payee: 'invalid', note: 'invalid', postings: 'invalid' },
  })
})

