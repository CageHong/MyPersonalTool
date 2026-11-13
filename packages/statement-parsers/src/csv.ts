// CSV 讀取(RFC 4180):欄位可以用雙引號包住,包住的欄位裡可以有逗號、換行,雙引號寫成兩個。
// 另外處理檔案開頭的 BOM,以及 CRLF / LF / CR 三種換行。

import { StatementFormatError } from './types'

export interface CsvRow {
  // 這一列從第幾行開始(從 1 算)
  line: number
  fields: string[]
}

export function parseCsv(text: string): CsvRow[] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const rows: CsvRow[] = []
  let fields: string[] = []
  let field = ''
  let quoted = false // 目前在引號包住的欄位裡
  let wasQuoted = false // 目前這個欄位用過引號(用來分辨空白行與只有一個空欄位的列)
  let line = 1
  let rowLine = 1

  const endRow = () => {
    fields.push(field)
    const blank = fields.length === 1 && fields[0] === '' && !wasQuoted
    if (!blank) rows.push({ line: rowLine, fields })
    fields = []
    field = ''
    wasQuoted = false
  }

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        if (ch === '\n' || (ch === '\r' && input[i + 1] !== '\n')) line++
        field += ch
      }
      continue
    }
    if (ch === '"' && field === '' && !wasQuoted) {
      quoted = true
      wasQuoted = true
    } else if (ch === ',') {
      fields.push(field)
      field = ''
      wasQuoted = false
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i++
      endRow()
      line++
      rowLine = line
    } else {
      field += ch
    }
  }
  if (quoted) throw new StatementFormatError(`第 ${rowLine} 行的引號沒有結束`)
  if (field !== '' || fields.length > 0 || wasQuoted) endRow()
  return rows
}

export interface CsvRecord {
  line: number
  // 欄位數跟欄位名那一行一樣時才有;不一樣時是 null,原始欄位在 fields
  record: Record<string, string> | null
  fields: string[]
}

export interface CsvTable {
  header: string[]
  records: CsvRecord[]
}

// 第一列當欄位名(去頭尾空白),其餘每列對成「欄位名 → 值」
export function readCsvTable(text: string): CsvTable {
  const [first, ...rest] = parseCsv(text)
  if (!first) return { header: [], records: [] }
  const header = first.fields.map((name) => name.trim())
  const records = rest.map(({ line, fields }) => ({
    line,
    fields,
    record:
      fields.length === header.length
        ? Object.fromEntries(header.map((name, index) => [name, fields[index]]))
        : null,
  }))
  return { header, records }
}
