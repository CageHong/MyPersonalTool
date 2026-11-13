import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sql } from 'drizzle-orm'
import { AT, freshLedger } from '../testing'
import { findPayeeByText, lookupPayee, normalizePayeeText, payeeDisplayName, resolvePayee } from './payees'

const suffixes = ['via Processor']

test('正規化:小寫、去頭尾空白、連續空白合成一個', () => {
  assert.equal(normalizePayeeText('  Some   Shop BV ', []), 'some shop bv')
})

test('正規化:去掉結尾的後綴,不分大小寫', () => {
  assert.equal(normalizePayeeText('Some Shop BV via PROCESSOR', suffixes), 'some shop bv')
  assert.equal(normalizePayeeText('Some Shop BV', suffixes), 'some shop bv')
})

test('後綴只在結尾、而且前面有其他文字時才去掉', () => {
  assert.equal(normalizePayeeText('via Processor shop', suffixes), 'via processor shop')
  assert.equal(normalizePayeeText('via Processor', suffixes), 'via processor')
  assert.equal(normalizePayeeText('Shopvia Processor', suffixes), 'shopvia processor')
})

test('顯示名稱保留大小寫,只整理空白與後綴', () => {
  assert.equal(payeeDisplayName(' Some  Shop BV via Processor', suffixes), 'Some Shop BV')
})

test('resolvePayee:第一次看到就新增收款人與別名;寫法只差大小寫、空白、後綴時是同一個', () => {
  const db = freshLedger()
  assert.equal(findPayeeByText(db, 'Some Shop BV', suffixes), null)
  const id = resolvePayee(db, ' Some  Shop BV via Processor', suffixes, AT)
  assert.equal(resolvePayee(db, 'some shop bv', suffixes), id)
  assert.equal(findPayeeByText(db, 'SOME SHOP BV', suffixes), id)
  assert.deepEqual(db.all(sql`SELECT name, created_at FROM finance_payees`), [
    { name: 'Some Shop BV', created_at: AT },
  ])
  assert.deepEqual(db.all(sql`SELECT alias, payee_id FROM finance_payee_aliases`), [
    { alias: 'some shop bv', payee_id: id },
  ])
})

test('resolvePayee:別名表沒有、但已經有同名的收款人時,別名掛到那個收款人', () => {
  const db = freshLedger()
  db.run(sql`INSERT INTO finance_payees (id, name, created_at) VALUES (7, 'Some Shop BV', ${AT})`)
  assert.equal(resolvePayee(db, 'Some Shop BV', suffixes), 7)
  assert.equal(db.all(sql`SELECT * FROM finance_payees`).length, 1)
  assert.equal(findPayeeByText(db, 'some shop bv', suffixes), 7)
})

test('resolvePayee:空白文字回傳 null,不新增', () => {
  const db = freshLedger()
  assert.equal(resolvePayee(db, '   ', suffixes), null)
  assert.equal(db.all(sql`SELECT * FROM finance_payees`).length, 0)
})

test('lookupPayee:只查不寫;別名優先,沒有別名就找同名的收款人', () => {
  const db = freshLedger()
  const shop = resolvePayee(db, 'Some Shop via Processor', suffixes, AT)
  db.run(sql`INSERT INTO finance_payees (id, name, created_at) VALUES (50, 'Corner Cafe', ${AT})`)
  assert.equal(lookupPayee(db, 'SOME SHOP', suffixes), shop)
  assert.equal(lookupPayee(db, 'Corner Cafe', suffixes), 50)
  assert.equal(lookupPayee(db, 'corner cafe', suffixes), null) // 顯示名稱保留大小寫,跟 resolvePayee 一樣
  assert.equal(lookupPayee(db, 'Nobody', suffixes), null)
  assert.equal(db.all(sql`SELECT * FROM finance_payee_aliases`).length, 1)
})
