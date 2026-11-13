// finance 的資料模型(SQLite)。這個檔是唯一的定義;改完跑 `npm run finance:db:generate` 產生 migration。
//
// 模型:交易(表頭)+ 分錄(複式,N 條)。分類是帳戶(expense / income),標籤掛在交易上。
// 金額:最小貨幣單位的整數(EUR 為分,TWD 為元)。正 = 借方(資產增加 / 支出增加),負 = 貸方。
// 不變量:同一筆交易內,每個幣別的分錄加總為零。由寫入的程式保證,financeUnbalanced 用來檢查。
// 時間:UTC 的 ISO 8601 文字,顯示時才轉時區;只有日期的欄位是 YYYY-MM-DD。
// Drizzle Kit 產生不出來的部分在 drizzle/ 的手寫 migration 裡:分錄幣別的 trigger、
// 帳戶名稱的唯一索引(索引裡有運算式)。
import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  sqliteView,
  text,
} from 'drizzle-orm/sqlite-core'
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'

// ── 設定 ──────────────────────────────────────────────────────────

// 鍵值設定。目前的鍵:display_currency(報表與合計的顯示幣別;內部換算基準固定是 EUR)
export const financeSettings = sqliteTable('finance_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})

export const financeCurrencies = sqliteTable(
  'finance_currencies',
  {
    // ISO 4217
    code: text('code').primaryKey(),
    // 最小貨幣單位的小數位數(EUR 2、TWD 0)
    exponent: integer('exponent').notNull(),
    name: text('name').notNull(),
  },
  (table) => [check('finance_currencies_exponent_ck', sql`${table.exponent} BETWEEN 0 AND 4`)],
)

// ── 帳戶 ──────────────────────────────────────────────────────────

// 帳戶群組:只決定顯示(側欄分組與合計),不影響帳戶的行為
export const financeAccountGroups = sqliteTable('finance_account_groups', {
  id: integer('id').primaryKey(),
  name: text('name').notNull().unique(),
  // 合計用的幣別;NULL = 用 display_currency
  currency: text('currency').references(() => financeCurrencies.code),
  color: text('color'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').notNull(),
})

// asset / liability:錢實際存放的地方,幣別固定。
// expense / income :分類,用 parentId 分層;currency 為 NULL = 可收任何幣別的分錄。
// equity           :系統帳戶(期初餘額、換匯)。
// 同類型、同一層內名稱不重複(唯一索引在手寫 migration 裡)。
export const financeAccounts = sqliteTable(
  'finance_accounts',
  {
    id: integer('id').primaryKey(),
    name: text('name').notNull(),
    type: text('type', { enum: ['asset', 'liability', 'equity', 'income', 'expense'] }).notNull(),
    // 決定帳戶的行為與流動性分類。asset:cash / bank / broker / receivable / deposit / prepaid;
    // liability:credit_card / loan
    subtype: text('subtype'),
    parentId: integer('parent_id').references((): AnySQLiteColumn => financeAccounts.id),
    currency: text('currency').references(() => financeCurrencies.code),
    // 只有 asset / liability 可以分組;NULL = 未分組
    groupId: integer('group_id').references(() => financeAccountGroups.id, { onDelete: 'set null' }),
    color: text('color'),
    // asset / liability:群組內的順序;分類:同一層內的順序
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    // true = 不可刪(期初餘額、換匯、手續費、未分類)
    isSystem: integer('is_system', { mode: 'boolean' }).notNull().default(false),
    // 來源系統的帳戶代碼,匯入時用來對到帳戶
    legacyId: text('legacy_id').unique(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    check(
      'finance_accounts_type_ck',
      sql`${table.type} IN ('asset','liability','equity','income','expense')`,
    ),
    check(
      'finance_accounts_currency_ck',
      sql`${table.type} NOT IN ('asset','liability') OR ${table.currency} IS NOT NULL`,
    ),
    check(
      'finance_accounts_group_ck',
      sql`${table.groupId} IS NULL OR ${table.type} IN ('asset','liability')`,
    ),
    check('finance_accounts_is_active_ck', sql`${table.isActive} IN (0,1)`),
    check('finance_accounts_is_system_ck', sql`${table.isSystem} IN (0,1)`),
  ],
)

// 信用卡帳戶(liability / credit_card)的專屬設定;一個帳戶最多一列。
// 每期帳單不存:期間與應繳金額由結帳日與分錄算出來
export const financeCreditCardDetails = sqliteTable(
  'finance_credit_card_details',
  {
    accountId: integer('account_id')
      .primaryKey()
      .references(() => financeAccounts.id, { onDelete: 'cascade' }),
    // 最小貨幣單位,幣別同帳戶
    creditLimit: integer('credit_limit'),
    // 餘額框顯示哪一個:balance = 餘額;available = 可用餘額(額度 + 餘額)
    balanceDisplay: text('balance_display', { enum: ['balance', 'available'] })
      .notNull()
      .default('balance'),
    // 每月第幾天結帳;該月沒有那一天就用月底
    statementDay: integer('statement_day'),
    // 繳款截止日的兩種表示法,最多填一個:每月第幾天 / 結帳日後第幾天
    dueDay: integer('due_day'),
    dueDaysAfterStatement: integer('due_days_after_statement'),
  },
  (table) => [
    check('finance_credit_card_details_limit_ck', sql`${table.creditLimit} > 0`),
    check(
      'finance_credit_card_details_display_ck',
      sql`${table.balanceDisplay} IN ('balance','available')`,
    ),
    check('finance_credit_card_details_statement_ck', sql`${table.statementDay} BETWEEN 1 AND 31`),
    check('finance_credit_card_details_due_day_ck', sql`${table.dueDay} BETWEEN 1 AND 31`),
    check('finance_credit_card_details_due_after_ck', sql`${table.dueDaysAfterStatement} >= 1`),
    check(
      'finance_credit_card_details_due_one_ck',
      sql`${table.dueDay} IS NULL OR ${table.dueDaysAfterStatement} IS NULL`,
    ),
  ],
)

// ── 收款人 ────────────────────────────────────────────────────────

// 交易的對象;不區分人和商家
export const financePayees = sqliteTable('finance_payees', {
  id: integer('id').primaryKey(),
  // 顯示名稱
  name: text('name').notNull().unique(),
  createdAt: text('created_at').notNull(),
})

// 匯入的原始文字 → 收款人。只做完全相同的比對;合併收款人 = 把別名移到另一個收款人
export const financePayeeAliases = sqliteTable(
  'finance_payee_aliases',
  {
    // 正規化後的文字(小寫、去頭尾空白、連續空白合成一個、去掉付款處理商後綴)
    alias: text('alias').primaryKey(),
    payeeId: integer('payee_id')
      .notNull()
      .references(() => financePayees.id, { onDelete: 'cascade' }),
  },
  (table) => [index('finance_payee_aliases_payee_idx').on(table.payeeId)],
)

// ── 交易與分錄 ────────────────────────────────────────────────────

// 交易的表頭。不存類型(支出 / 收入 / 轉帳),由分錄涉及的帳戶推導
export const financeTransactions = sqliteTable(
  'finance_transactions',
  {
    id: integer('id').primaryKey(),
    occurredAt: text('occurred_at').notNull(),
    payeeId: integer('payee_id').references(() => financePayees.id),
    note: text('note'),
    source: text('source', { enum: ['wise_csv', 'manual', 'migration', 'scheduled'] }).notNull(),
    // 來源系統的 ID,匯入時去重用
    externalId: text('external_id').unique(),
    // 配對到的週期項目
    scheduledId: integer('scheduled_id').references(
      (): AnySQLiteColumn => financeScheduledTransactions.id,
      { onDelete: 'set null' },
    ),
    // JSON:匯入時的原始值(對象、分類、標籤、來源分類、匯率、手續費)。只供還原與稽核,不拿來比對
    importMeta: text('import_meta'),
    // 支出交易的分類是怎麼決定的;NULL = 未分類或不是支出
    categorySource: text('category_source', {
      enum: ['legacy', 'scheduled', 'payee_history', 'source_category', 'correction'],
    }),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    check(
      'finance_transactions_source_ck',
      sql`${table.source} IN ('wise_csv','manual','migration','scheduled')`,
    ),
    check(
      'finance_transactions_category_source_ck',
      sql`${table.categorySource} IN ('legacy','scheduled','payee_history','source_category','correction')`,
    ),
    index('finance_transactions_occurred_idx').on(table.occurredAt),
    index('finance_transactions_payee_idx').on(table.payeeId),
    index('finance_transactions_scheduled_idx').on(table.scheduledId),
  ],
)

// 分錄。帳戶有固定幣別時,分錄幣別必須相同(由 trigger 檢查)
export const financePostings = sqliteTable(
  'finance_postings',
  {
    id: integer('id').primaryKey(),
    transactionId: integer('transaction_id')
      .notNull()
      .references(() => financeTransactions.id, { onDelete: 'cascade' }),
    accountId: integer('account_id')
      .notNull()
      .references(() => financeAccounts.id),
    // 最小貨幣單位;正 = 借,負 = 貸
    amount: integer('amount').notNull(),
    currency: text('currency')
      .notNull()
      .references(() => financeCurrencies.code),
    memo: text('memo'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [
    check('finance_postings_amount_ck', sql`${table.amount} <> 0`),
    index('finance_postings_tx_idx').on(table.transactionId),
    index('finance_postings_account_idx').on(table.accountId),
  ],
)

// 不變量檢查:出現任何一列都代表有交易借貸不平
export const financeUnbalanced = sqliteView('finance_v_unbalanced', {
  transactionId: integer('transaction_id').notNull(),
  currency: text('currency').notNull(),
  residual: integer('residual').notNull(),
}).as(
  sql`SELECT transaction_id, currency, SUM(amount) AS residual FROM finance_postings GROUP BY transaction_id, currency HAVING SUM(amount) <> 0`,
)

// ── 標籤 ──────────────────────────────────────────────────────────

export const financeTags = sqliteTable('finance_tags', {
  id: integer('id').primaryKey(),
  name: text('name').notNull().unique(),
  color: text('color'),
  // 旅行標籤:人在外地的第一天與最後一天;一般標籤為 NULL。日期範圍是自動套用的線索,不是條件
  startsOn: text('starts_on'),
  endsOn: text('ends_on'),
  createdAt: text('created_at').notNull(),
})

export const financeTransactionTags = sqliteTable(
  'finance_transaction_tags',
  {
    transactionId: integer('transaction_id')
      .notNull()
      .references(() => financeTransactions.id, { onDelete: 'cascade' }),
    tagId: integer('tag_id')
      .notNull()
      .references(() => financeTags.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.transactionId, table.tagId] })],
)

// ── 匯率(只用於顯示與報表的換算;換匯實際的金額記在交易的分錄裡)──

// 每種幣別每天一筆:1 單位 currency = rateToEur 歐元。歐元是固定的內部基準
export const financeFxRates = sqliteTable(
  'finance_fx_rates',
  {
    date: text('date').notNull(),
    currency: text('currency')
      .notNull()
      .references(() => financeCurrencies.code),
    rateToEur: real('rate_to_eur').notNull(),
    source: text('source').notNull(),
    fetchedAt: text('fetched_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.date, table.currency] }),
    check('finance_fx_rates_rate_ck', sql`${table.rateToEur} > 0`),
  ],
)

// 來源剛好提供某一對幣別的直接報價時才存:1 base = rate quote。
// 方向固定為 base < quote(字母順序),來源給反方向就取倒數再存;一天一對只有一筆
export const financeFxDirectQuotes = sqliteTable(
  'finance_fx_direct_quotes',
  {
    date: text('date').notNull(),
    base: text('base')
      .notNull()
      .references(() => financeCurrencies.code),
    quote: text('quote')
      .notNull()
      .references(() => financeCurrencies.code),
    rate: real('rate').notNull(),
    source: text('source').notNull(),
    fetchedAt: text('fetched_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.date, table.base, table.quote] }),
    check('finance_fx_direct_quotes_direction_ck', sql`${table.base} < ${table.quote}`),
    check('finance_fx_direct_quotes_rate_ck', sql`${table.rate} > 0`),
  ],
)

// ── 自動分類 ──────────────────────────────────────────────────────

// 手寫的分類規則。payee:交易的收款人就是 payeeId;source_category:來源給的分類等於 matchValue
export const financeRules = sqliteTable(
  'finance_rules',
  {
    id: integer('id').primaryKey(),
    matchField: text('match_field', { enum: ['payee', 'source_category'] }).notNull(),
    payeeId: integer('payee_id').references(() => financePayees.id, { onDelete: 'cascade' }),
    matchValue: text('match_value'),
    assignAccountId: integer('assign_account_id').references(() => financeAccounts.id),
    // JSON:標籤名稱的陣列
    assignTags: text('assign_tags').notNull().default('[]'),
    // 越小越優先
    priority: integer('priority').notNull().default(10),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    check(
      'finance_rules_match_ck',
      sql`(${table.matchField} = 'payee' AND ${table.payeeId} IS NOT NULL AND ${table.matchValue} IS NULL) OR (${table.matchField} = 'source_category' AND ${table.payeeId} IS NULL AND ${table.matchValue} IS NOT NULL)`,
    ),
    check('finance_rules_is_active_ck', sql`${table.isActive} IN (0,1)`),
    index('finance_rules_payee_idx').on(table.payeeId),
  ],
)

// 週期項目:固定收支的「預期」。不產生交易;匯入的真實交易符合條件時連結過來
// (financeTransactions.scheduledId),並記到 accountId 指定的分類。
// 配對條件:收款人相同 + 幣別相同 + 金額在 [amountMin, amountMax] + 日期在 [startsOn, endsOn](有設定時)
export const financeScheduledTransactions = sqliteTable(
  'finance_scheduled_transactions',
  {
    id: integer('id').primaryKey(),
    name: text('name').notNull().unique(),
    // 分類(通常是子分類)
    accountId: integer('account_id')
      .notNull()
      .references(() => financeAccounts.id),
    payeeId: integer('payee_id')
      .notNull()
      .references(() => financePayees.id),
    // 最小貨幣單位
    amountMin: integer('amount_min').notNull(),
    amountMax: integer('amount_max').notNull(),
    currency: text('currency')
      .notNull()
      .references(() => financeCurrencies.code),
    // 每 interval 個 frequency 一次
    frequency: text('frequency', { enum: ['weekly', 'monthly', 'yearly'] }).notNull(),
    interval: integer('interval').notNull().default(1),
    startsOn: text('starts_on'),
    endsOn: text('ends_on'),
    note: text('note'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    check('finance_scheduled_transactions_min_ck', sql`${table.amountMin} >= 0`),
    check('finance_scheduled_transactions_max_ck', sql`${table.amountMax} >= ${table.amountMin}`),
    check(
      'finance_scheduled_transactions_frequency_ck',
      sql`${table.frequency} IN ('weekly','monthly','yearly')`,
    ),
    check('finance_scheduled_transactions_interval_ck', sql`${table.interval} >= 1`),
    check('finance_scheduled_transactions_is_active_ck', sql`${table.isActive} IN (0,1)`),
  ],
)
