import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sql } from 'drizzle-orm'
import { ValidationError } from '../errors'
import { getV2RetiredAt } from '../ledger/settings'
import { createTransaction } from '../ledger/transactions'
import { ACCOUNTS, AT, freshLedger } from '../testing'
import { applyTagRange, createTag, deleteTag, listTagsForAdmin, mergeTag, previewTagRange, updateTag } from './index'

function fieldsOf(fn: () => unknown): Record<string, string> {
  try {
    fn()
  } catch (error) {
    assert.ok(error instanceof ValidationError, String(error))
    return error.fields
  }
  assert.fail('應該要丟 ValidationError')
}

// 三筆交易:1/10、1/12、1/20(UTC)
function ledger() {
  const db = freshLedger()
  const ids = ['10', '12', '20'].map((day) =>
    createTransaction(db, {
      occurredAt: `2030-01-${day}T09:00:00+00:00`, source: 'manual',
      postings: [{ accountId: ACCOUNTS.wiseEur, amount: -100, currency: 'EUR' }, { accountId: ACCOUNTS.food, amount: 100, currency: 'EUR' }],
    }, AT),
  )
  return { db, ids }
}

const tagNames = (db: ReturnType<typeof freshLedger>, id: number) =>
  db.all<{ name: string }>(sql`SELECT g.name FROM finance_transaction_tags tt JOIN finance_tags g ON g.id = tt.tag_id WHERE tt.transaction_id = ${id} ORDER BY g.name`).map((r) => r.name)

test('新增、改名、日期範圍;名稱不能重複;範圍要成對、結束不早於開始', () => {
  const { db } = ledger()
  const id = createTag(db, { name: ' Rome ', startsOn: '2030-01-11', endsOn: '2030-01-15' }, '2030-02-01T00:00:00Z')
  assert.deepEqual(listTagsForAdmin(db), [{ id, name: 'Rome', startsOn: '2030-01-11', endsOn: '2030-01-15', transactions: 0 }])
  assert.equal(getV2RetiredAt(db), '2030-02-01T00:00:00+00:00')
  updateTag(db, id, { name: 'Roma' })
  assert.equal(listTagsForAdmin(db)[0].name, 'Roma')
  assert.deepEqual(fieldsOf(() => createTag(db, { name: 'Roma', startsOn: null, endsOn: null })), { name: 'duplicate' })
  assert.deepEqual(fieldsOf(() => createTag(db, { name: 'X', startsOn: '2030-01-01', endsOn: null })), { endsOn: 'range_incomplete' })
  assert.deepEqual(fieldsOf(() => updateTag(db, id, { endsOn: '2030-01-01' })), { endsOn: 'before_start' })
})

test('範圍內加標籤:預覽列出範圍內還沒有標籤的;套用只加選中的、範圍內的', () => {
  const { db, ids } = ledger()
  const id = createTag(db, { name: 'Trip', startsOn: '2030-01-10', endsOn: '2030-01-12' })
  assert.deepEqual(previewTagRange(db, id).map((i) => i.transactionId), [ids[0], ids[1]])
  assert.deepEqual(applyTagRange(db, id, [ids[1], ids[2]]), { applied: 1 })
  assert.deepEqual(tagNames(db, ids[1]), ['Trip'])
  assert.deepEqual(tagNames(db, ids[2]), [])
  assert.deepEqual(previewTagRange(db, id).map((i) => i.transactionId), [ids[0]])
  const plain = createTag(db, { name: 'Plain', startsOn: null, endsOn: null })
  assert.deepEqual(fieldsOf(() => previewTagRange(db, plain)), { tag: 'no_range' })
})

test('合併:來源的交易都加上目標(不重複),來源刪掉;刪除標籤時交易上的連結一起刪', () => {
  const { db, ids } = ledger()
  const a = createTag(db, { name: 'A', startsOn: null, endsOn: null })
  const b = createTag(db, { name: 'B', startsOn: null, endsOn: null })
  db.run(sql`INSERT INTO finance_transaction_tags VALUES (${ids[0]}, ${a}), (${ids[1]}, ${a}), (${ids[1]}, ${b})`)
  assert.deepEqual(fieldsOf(() => mergeTag(db, a, a)), { targetId: 'self' })
  mergeTag(db, a, b)
  assert.deepEqual(tagNames(db, ids[0]), ['B'])
  assert.deepEqual(tagNames(db, ids[1]), ['B'])
  assert.deepEqual(listTagsForAdmin(db).map((t) => [t.name, t.transactions]), [['B', 2]])
  deleteTag(db, b)
  assert.deepEqual(tagNames(db, ids[0]), [])
})
