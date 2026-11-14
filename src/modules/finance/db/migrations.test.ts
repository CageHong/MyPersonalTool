// 最新的 migration 不會弄丟資料:套用前後每張表的筆數相同、外鍵都指得到資料。
// 種子照「倒數第二版」的 schema 寫(名稱與數字都是虛構的);migration 改到這裡用到的欄位時跟著更新。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkNewestMigration } from '../../../platform/testing/migrationCheck'
import { MIGRATIONS_FOLDER } from './index'

const AT = '2030-01-01T00:00:00+00:00'

const SEED = `
INSERT INTO finance_settings VALUES ('display_currency', 'EUR');
INSERT INTO finance_currencies VALUES ('EUR', 2, 'Euro'), ('USD', 2, 'US Dollar');
INSERT INTO finance_account_groups (id, name, sort_order, created_at) VALUES (1, 'Banks', 0, '${AT}');
INSERT INTO finance_accounts (id, name, type, subtype, parent_id, currency, group_id, is_system, legacy_id, created_at) VALUES
  (1, 'Main', 'asset', 'bank', NULL, 'EUR', 1, 0, 'MAIN_EUR', '${AT}'),
  (2, 'Card', 'liability', 'credit_card', NULL, 'EUR', 1, 0, NULL, '${AT}'),
  (3, 'Food', 'expense', NULL, NULL, NULL, NULL, 0, NULL, '${AT}'),
  (4, 'Snacks', 'expense', NULL, 3, NULL, NULL, 0, NULL, '${AT}'),
  (5, '未分類', 'expense', NULL, NULL, NULL, NULL, 1, NULL, '${AT}');
INSERT INTO finance_credit_card_details (account_id, credit_limit, statement_day) VALUES (2, 100000, 25);
INSERT INTO finance_payees (id, name, created_at) VALUES (1, 'Corner Shop', '${AT}');
INSERT INTO finance_payee_aliases VALUES ('corner shop', 1);
INSERT INTO finance_scheduled_transactions
  (id, name, account_id, payee_id, amount_min, amount_max, currency, frequency, created_at)
  VALUES (1, 'Weekly snacks', 4, 1, 100, 900, 'EUR', 'weekly', '${AT}');
INSERT INTO finance_transactions (id, occurred_at, payee_id, source, external_id, scheduled_id, category_source, created_at, updated_at) VALUES
  (1, '${AT}', 1, 'manual', 'X-1', 1, 'scheduled', '${AT}', '${AT}'),
  (2, '${AT}', 1, 'manual', 'X-2', NULL, 'legacy', '${AT}', '${AT}');
INSERT INTO finance_postings (transaction_id, account_id, amount, currency) VALUES
  (1, 1, -500, 'EUR'), (1, 4, 500, 'EUR'), (2, 2, -300, 'EUR'), (2, 3, 300, 'EUR');
INSERT INTO finance_tags (id, name, created_at) VALUES (1, 'Trip', '${AT}');
INSERT INTO finance_transaction_tags VALUES (1, 1), (2, 1);
INSERT INTO finance_fx_rates VALUES ('2030-01-01', 'USD', 0.9, 'test', '${AT}');
INSERT INTO finance_fx_direct_quotes VALUES ('2030-01-01', 'EUR', 'USD', 1.1, 'test', '${AT}');
INSERT INTO finance_rules (match_field, payee_id, match_value, assign_account_id, created_at) VALUES
  ('payee', 1, NULL, 3, '${AT}'), ('source_category', NULL, 'Groceries', 3, '${AT}');
`

test('最新的 migration 保留所有資料', () => {
  const result = checkNewestMigration(MIGRATIONS_FOLDER, (sqlite) => sqlite.exec(SEED))
  assert.ok(result.newest)
  for (const [table, n] of Object.entries(result.before)) {
    if (!table.startsWith('finance_')) continue
    assert.ok(n > 0, `種子沒有灌到 ${table}`)
  }
  assert.deepEqual(result.changed, [])
  assert.deepEqual(result.violations, [])
})
