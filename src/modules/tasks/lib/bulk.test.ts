import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { joinAsSingleLine, parseBulkLines } from './bulk'

describe('parseBulkLines', () => {
  test('splits on any newline style and drops empty lines', () => {
    assert.deepEqual(parseBulkLines('a\nb\r\nc\rd\n\n  \n'), ['a', 'b', 'c', 'd'])
  })

  test('a single line stays a single entry', () => {
    assert.deepEqual(parseBulkLines('  買牛奶  '), ['買牛奶'])
  })

  test('strips list markers and indentation', () => {
    const text = ['- 一', '* 二', '• 三', '1. 四', '2) 五', '[ ] 六', '[x] 七', '\t  - 八'].join('\n')
    assert.deepEqual(parseBulkLines(text), ['一', '二', '三', '四', '五', '六', '七', '八'])
  })

  test('strips stacked markers', () => {
    assert.deepEqual(parseBulkLines('- [ ] 買牛奶\n1. [x] 寄信'), ['買牛奶', '寄信'])
  })

  test('a line that is only a marker is dropped', () => {
    assert.deepEqual(parseBulkLines('- a\n-\n[ ]\n- b'), ['a', 'b'])
  })

  test('does not strip characters that only look like markers', () => {
    assert.deepEqual(parseBulkLines('-5 度\n3.14 是圓周率\n*重要*'), ['-5 度', '3.14 是圓周率', '*重要*'])
  })

  test('does not infer structure from unmarked lines', () => {
    assert.deepEqual(parseBulkLines('採買\n- 牛奶\n- 蛋'), ['採買', '牛奶', '蛋'])
  })
})

describe('joinAsSingleLine', () => {
  test('joins lines with a space and keeps markers', () => {
    assert.equal(joinAsSingleLine('- a\n\n  - b \r\nc'), '- a - b c')
  })
})
