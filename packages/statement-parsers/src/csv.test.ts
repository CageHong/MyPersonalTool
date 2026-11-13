import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseCsv, readCsvTable } from './csv'
import { StatementFormatError } from './types'

const fields = (text: string) => parseCsv(text).map((row) => row.fields)

test('一般的列;結尾有沒有換行都一樣', () => {
  assert.deepEqual(fields('a,b\n1,2\n'), [['a', 'b'], ['1', '2']])
  assert.deepEqual(fields('a,b\n1,2'), [['a', 'b'], ['1', '2']])
})

test('CRLF、CR 換行', () => {
  assert.deepEqual(fields('a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']])
  assert.deepEqual(fields('a,b\r1,2'), [['a', 'b'], ['1', '2']])
})

test('開頭的 BOM 不算進第一個欄位', () => {
  assert.deepEqual(fields('﻿a,b\n'), [['a', 'b']])
})

test('引號裡的逗號、換行、兩個雙引號', () => {
  assert.deepEqual(fields('"x, y","line1\nline2","say ""hi"""\n'), [
    ['x, y', 'line1\nline2', 'say "hi"'],
  ])
})

test('空欄位保留;空白行略過;只有一個空引號欄位的列保留', () => {
  assert.deepEqual(fields('a,,c\n\n,\n""\n'), [['a', '', 'c'], ['', ''], ['']])
})

test('行號是每一列開始的那一行,引號裡的換行也算', () => {
  const rows = parseCsv('h\n"a\nb"\n\nc\n')
  assert.deepEqual(
    rows.map((row) => row.line),
    [1, 2, 5],
  )
})

test('引號沒有結束時丟出 StatementFormatError', () => {
  assert.throws(() => parseCsv('a\n"b'), StatementFormatError)
})

test('readCsvTable:欄位名去頭尾空白;欄位數不對的列 record 是 null', () => {
  const table = readCsvTable(' ID ,Name\n1,Some Shop\n2\n')
  assert.deepEqual(table.header, ['ID', 'Name'])
  assert.deepEqual(table.records[0].record, { ID: '1', Name: 'Some Shop' })
  assert.equal(table.records[1].record, null)
  assert.deepEqual(table.records[1].fields, ['2'])
})

test('readCsvTable:空檔案', () => {
  assert.deepEqual(readCsvTable(''), { header: [], records: [] })
})
