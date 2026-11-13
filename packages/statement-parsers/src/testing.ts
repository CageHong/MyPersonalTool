// 測試用:組出 Wise 格式的 CSV。名稱與數字都是虛構的。

import { WISE_CSV_COLUMNS } from './wise'

const DEFAULTS: Record<string, string> = {
  ID: 'CARD-1001',
  Status: 'COMPLETED',
  Direction: 'OUT',
  'Created on': '2030-01-15 09:30:00',
  'Source fee amount': '0.00',
  'Source fee currency': 'EUR',
  'Source name': 'Alex Example',
  'Source amount (after fees)': '12.30',
  'Source currency': 'EUR',
  'Target name': 'Some Shop BV',
  'Target amount (after fees)': '12.30',
  'Target currency': 'EUR',
  'Exchange rate': '1.0',
  Reference: '',
  Category: 'Groceries',
}

function quote(field: string): string {
  return /[",\r\n]/.test(field) ? `"${field.replaceAll('"', '""')}"` : field
}

export function wiseCsv(rows: Record<string, string>[], columns = WISE_CSV_COLUMNS): string {
  const lines = rows.map((row) =>
    columns.map((column) => quote(row[column] ?? DEFAULTS[column] ?? '')).join(','),
  )
  return [columns.join(','), ...lines].join('\n') + '\n'
}
