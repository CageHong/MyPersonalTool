import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EMPTY_FILTER, filterToSearchParams, isFilterEmpty, parseTransactionFilter } from './transactions'
import type { TransactionFilter } from './transactions'

const parse = (query: string) => parseTransactionFilter(new URLSearchParams(query))

test('沒有參數 = 空的篩選、由新到舊', () => {
  assert.deepEqual(parse(''), { ok: true, filter: { order: 'desc' } })
})

test('每個參數都解析成對應的欄位;空字串當作沒給;不認識的參數不理會', () => {
  assert.deepEqual(
    parse('from=2026-01-01&to=2026-01-31&account=3&category=10&tag=2&payee=7&kind=expense&uncategorized=1&q=%20cafe%20&order=asc&cursor=x&limit=5&note='),
    {
      ok: true,
      filter: {
        from: '2026-01-01',
        to: '2026-01-31',
        accountId: 3,
        categoryId: 10,
        tagId: 2,
        payeeId: 7,
        kind: 'expense',
        uncategorized: true,
        q: 'cafe',
        order: 'asc',
      },
    },
  )
})

test('不合法的值逐欄列出', () => {
  assert.deepEqual(parse('from=2026-02-30&to=2026-13-01&account=0&tag=a&kind=x&uncategorized=yes&order=up'), {
    ok: false,
    fields: { from: 'invalid', to: 'invalid', account: 'invalid', tag: 'invalid', kind: 'invalid', uncategorized: 'invalid', order: 'invalid' },
  })
  assert.deepEqual(parse('from=2026-02-01&to=2026-01-01'), { ok: false, fields: { to: 'before_from' } })
  assert.deepEqual(parse(`q=${'a'.repeat(101)}`), { ok: false, fields: { q: 'too_long' } })
})

test('寫成網址參數再解析回來不變;預設值不寫出來', () => {
  const filter: TransactionFilter = { from: '2026-01-01', categoryId: 4, kind: 'transfer', uncategorized: true, q: 'a b', order: 'asc' }
  assert.deepEqual(parseTransactionFilter(filterToSearchParams(filter)), { ok: true, filter })
  assert.equal(filterToSearchParams(EMPTY_FILTER).toString(), '')
})

test('只改排序不算有篩選', () => {
  assert.equal(isFilterEmpty({ order: 'asc' }), true)
  assert.equal(isFilterEmpty({ order: 'desc', tagId: 1 }), false)
})
