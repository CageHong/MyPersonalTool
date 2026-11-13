// 來源偵測:看欄位名的組合判斷是哪個來源的檔案。新增來源時在 PARSERS 加一項。

import { readCsvTable } from './csv'
import { isWiseCsvHeader, parseWiseCsv } from './wise'
import type { ParseResult, StatementSource } from './types'

interface SourceParser {
  source: StatementSource
  matchesHeader: (header: readonly string[]) => boolean
  parse: (text: string) => ParseResult
}

const PARSERS: readonly SourceParser[] = [
  { source: 'wise_csv', matchesHeader: isWiseCsvHeader, parse: parseWiseCsv },
]

function findParser(text: string): SourceParser | null {
  const { header } = readCsvTable(text)
  return PARSERS.find((parser) => parser.matchesHeader(header)) ?? null
}

// 認不出來時回傳 null
export function detectSource(text: string): StatementSource | null {
  return findParser(text)?.source ?? null
}

// 偵測來源並解析;認不出來時回傳 null
export function parseStatement(text: string): ParseResult | null {
  return findParser(text)?.parse(text) ?? null
}
