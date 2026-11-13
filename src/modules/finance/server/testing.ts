// 測試用:建一個有幣別、帳戶、系統帳戶的空帳本。名稱與數字都是虛構的。
import { sql } from 'drizzle-orm'
import { applyMigrations, openDb } from '../db/index'

export const AT = '2030-01-01T00:00:00+00:00'

export const ACCOUNTS = {
  wiseEur: 1,
  wiseUsd: 2,
  otherBank: 3,
  uncategorized: 10,
  fee: 11,
  food: 12,
  uncategorizedIncome: 13,
  exchange: 14,
} as const

export function freshLedger() {
  const db = openDb(':memory:')
  applyMigrations(db)
  db.run(sql`INSERT INTO finance_currencies VALUES
             ('EUR', 2, 'Euro'), ('USD', 2, 'US Dollar'), ('TWD', 0, 'New Taiwan Dollar')`)
  db.run(sql`INSERT INTO finance_accounts (id, name, type, subtype, currency, legacy_id, created_at) VALUES
             (1, 'Wise EUR', 'asset', 'cash', 'EUR', 'WISE_EUR', ${AT}),
             (2, 'Wise USD', 'asset', 'cash', 'USD', 'WISE_USD', ${AT}),
             (3, 'Other Bank', 'asset', 'bank', 'TWD', 'BANK_TWD', ${AT})`)
  db.run(sql`INSERT INTO finance_accounts (id, name, type, is_system, created_at) VALUES
             (10, '未分類', 'expense', 1, ${AT}), (11, '手續費', 'expense', 1, ${AT}),
             (12, 'Food', 'expense', 0, ${AT}), (13, '未分類收入', 'income', 1, ${AT}),
             (14, '換匯', 'equity', 1, ${AT})`)
  return db
}
