import assert from 'node:assert/strict'
import { test } from 'node:test'
import { wiseCsv } from './testing'
import { StatementFormatError } from './types'
import { isWiseCsvHeader, parseWiseCsv, WISE_CSV_COLUMNS } from './wise'

function parseOne(row: Record<string, string>) {
  const result = parseWiseCsv(wiseCsv([row]))
  assert.deepEqual(result.skipped, [])
  assert.equal(result.transactions.length, 1)
  return result.transactions[0]
}

function skipOne(row: Record<string, string>) {
  const result = parseWiseCsv(wiseCsv([row]))
  assert.deepEqual(result.transactions, [])
  assert.equal(result.skipped.length, 1)
  return result.skipped[0]
}

test('OUT:從來源幣別流出,對象是 Target name', () => {
  const tx = parseOne({ Reference: 'order 77' })
  assert.equal(tx.source, 'wise_csv')
  assert.equal(tx.kind, 'out')
  assert.equal(tx.externalId, 'CARD-1001')
  assert.equal(tx.occurredAt, '2030-01-15T09:30:00+00:00')
  assert.deepEqual(tx.movements, [{ account: 'wise:EUR', currency: 'EUR', amount: '-12.30' }])
  assert.equal(tx.fee, null)
  assert.equal(tx.counterparty, 'Some Shop BV')
  assert.equal(tx.reference, 'order 77')
  assert.equal(tx.sourceCategory, 'Groceries')
  assert.equal(tx.line, 2)
})

test('OUT:手續費另外列,不併進金額', () => {
  const tx = parseOne({
    'Source amount (after fees)': '100.00',
    'Source currency': 'usd',
    'Source fee amount': '1.25',
    'Source fee currency': 'USD',
  })
  assert.deepEqual(tx.movements, [{ account: 'wise:USD', currency: 'USD', amount: '-100.00' }])
  assert.deepEqual(tx.fee, { account: 'wise:USD', currency: 'USD', amount: '1.25' })
})

test('OUT:付給別的幣別時,仍然只記來源幣別的流出', () => {
  const tx = parseOne({
    'Source amount (after fees)': '50.00',
    'Source currency': 'EUR',
    'Target amount (after fees)': '54.10',
    'Target currency': 'USD',
  })
  assert.deepEqual(tx.movements, [{ account: 'wise:EUR', currency: 'EUR', amount: '-50.00' }])
  assert.equal(tx.raw['Target amount (after fees)'], '54.10')
})

test('IN:金額與幣別讀 Target,對象讀 Source name', () => {
  const tx = parseOne({
    ID: 'TRANSFER-2002',
    Direction: 'IN',
    'Source name': 'Jordan Sample',
    'Source amount (after fees)': '1000.00',
    'Source currency': 'USD',
    'Target name': 'Alex Example',
    'Target amount (after fees)': '915.40',
    'Target currency': 'EUR',
  })
  assert.equal(tx.kind, 'in')
  assert.deepEqual(tx.movements, [{ account: 'wise:EUR', currency: 'EUR', amount: '915.40' }])
  assert.equal(tx.counterparty, 'Jordan Sample')
})

test('IN:手續費不進 fee,原始值留在 raw', () => {
  const tx = parseOne({
    Direction: 'IN',
    'Source fee amount': '4.50',
    'Source fee currency': 'USD',
  })
  assert.equal(tx.fee, null)
  assert.equal(tx.raw['Source fee amount'], '4.50')
})

test('NEUTRAL:一筆交易兩個變動,先流出後流入;ID 不加後綴', () => {
  const tx = parseOne({
    ID: 'BALANCE-3003',
    Direction: 'NEUTRAL',
    'Source amount (after fees)': '200.00',
    'Source currency': 'USD',
    'Source fee amount': '0.80',
    'Source fee currency': 'USD',
    'Target amount (after fees)': '183.20',
    'Target currency': 'EUR',
    'Source name': '',
    'Target name': '',
  })
  assert.equal(tx.kind, 'exchange')
  assert.equal(tx.externalId, 'BALANCE-3003')
  assert.deepEqual(tx.movements, [
    { account: 'wise:USD', currency: 'USD', amount: '-200.00' },
    { account: 'wise:EUR', currency: 'EUR', amount: '183.20' },
  ])
  assert.deepEqual(tx.fee, { account: 'wise:USD', currency: 'USD', amount: '0.80' })
  assert.equal(tx.counterparty, null)
})

test('空的對象、備註、分類是 null', () => {
  const tx = parseOne({ 'Target name': ' ', Reference: '', Category: '' })
  assert.equal(tx.counterparty, null)
  assert.equal(tx.reference, null)
  assert.equal(tx.sourceCategory, null)
})

test('Note 欄:有就讀進 note,沒有這一欄或是空的就是 null', () => {
  assert.equal(parseOne({}).note, null)
  const columns = [...WISE_CSV_COLUMNS, 'Note']
  const withNote = parseWiseCsv(wiseCsv([{ Note: ' shared dinner ' }, { Note: '' }], columns))
  assert.deepEqual(
    withNote.transactions.map((tx) => tx.note),
    ['shared dinner', null],
  )
})

test('raw 保留這一列所有欄位的原文', () => {
  const tx = parseOne({ 'Target name': 'Shop, "Quoted" BV', 'Exchange rate': '1.0825' })
  assert.equal(tx.raw['Target name'], 'Shop, "Quoted" BV')
  assert.equal(tx.raw['Exchange rate'], '1.0825')
  assert.deepEqual(Object.keys(tx.raw), [...WISE_CSV_COLUMNS])
})

test('狀態:取消、處理中、不認得的狀態都略過,附原文', () => {
  for (const status of ['CANCELLED', 'PENDING', 'UNKNOWN', 'SOMETHING_NEW']) {
    const skipped = skipOne({ Status: status })
    assert.equal(skipped.reason, 'status')
    assert.equal(skipped.detail, `${status} OUT`)
    assert.equal(skipped.line, 2)
  }
})

test('REFUNDED:只收 IN', () => {
  assert.equal(skipOne({ Status: 'REFUNDED', Direction: 'OUT' }).reason, 'status')
  assert.equal(skipOne({ Status: 'REFUNDED', Direction: 'NEUTRAL' }).reason, 'status')
  assert.equal(parseOne({ Status: 'REFUNDED', Direction: 'IN' }).kind, 'in')
})

test('沒有 ID、方向不認得、日期不合法', () => {
  assert.equal(skipOne({ ID: ' ' }).reason, 'missing_id')
  assert.equal(skipOne({ Direction: 'SIDEWAYS' }).reason, 'unknown_direction')
  assert.equal(skipOne({ 'Created on': '15/01/2030 09:30' }).reason, 'invalid_date')
  assert.equal(skipOne({ 'Created on': '2030-02-30 09:30:00' }).reason, 'invalid_date')
})

test('金額不合法或不大於零時略過', () => {
  for (const amount of ['', '0.00', '-5.00', '1,200.00', 'abc']) {
    assert.equal(skipOne({ 'Source amount (after fees)': amount }).reason, 'invalid_amount', amount)
  }
  assert.equal(
    skipOne({ Direction: 'IN', 'Target amount (after fees)': '0' }).reason,
    'invalid_amount',
  )
  assert.equal(skipOne({ 'Source fee amount': 'x' }).reason, 'invalid_amount')
})

test('IN 不看 Source 的金額;OUT 不看 Target 的金額', () => {
  assert.equal(parseOne({ Direction: 'IN', 'Source amount (after fees)': '' }).kind, 'in')
  assert.equal(parseOne({ 'Target amount (after fees)': '' }).kind, 'out')
})

test('欄位數不對的列略過,其他列照常', () => {
  const result = parseWiseCsv(wiseCsv([{ ID: 'CARD-1' }]) + 'CARD-2,COMPLETED\n')
  assert.equal(result.transactions.length, 1)
  assert.equal(result.skipped.length, 1)
  assert.equal(result.skipped[0].reason, 'malformed_row')
  assert.equal(result.skipped[0].line, 3)
})

test('多列:行號對應檔案裡的行', () => {
  const result = parseWiseCsv(
    wiseCsv([{ ID: 'CARD-1' }, { ID: 'CARD-2', Status: 'CANCELLED' }, { ID: 'CARD-3' }]),
  )
  assert.deepEqual(
    result.transactions.map((tx) => [tx.externalId, tx.line]),
    [
      ['CARD-1', 2],
      ['CARD-3', 4],
    ],
  )
  assert.equal(result.skipped[0].line, 3)
})

test('欄位順序不影響;多出來的欄位留在 raw', () => {
  const columns = ['Note', ...[...WISE_CSV_COLUMNS].reverse()]
  const result = parseWiseCsv(wiseCsv([{ Note: 'extra' }], columns))
  assert.equal(result.transactions[0].raw.Note, 'extra')
  assert.equal(result.transactions[0].counterparty, 'Some Shop BV')
})

test('缺欄位時丟出 StatementFormatError,訊息列出缺的欄位', () => {
  const columns = WISE_CSV_COLUMNS.filter((name) => name !== 'Source name')
  assert.equal(isWiseCsvHeader(columns), false)
  assert.throws(
    () => parseWiseCsv(wiseCsv([{}], columns)),
    (error: unknown) =>
      error instanceof StatementFormatError && error.message.includes('Source name'),
  )
})
