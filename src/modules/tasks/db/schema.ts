import { sql } from 'drizzle-orm'
import { check, index, sqliteTable, integer, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'

export const task = sqliteTable(
  'task',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    title: text('title').notNull(),
    notes: text('notes'),
    // 日曆日,YYYY-MM-DD;不是時間戳
    dueDate: text('due_date'),
    // HH:MM,有指定時刻才填
    dueTime: text('due_time'),
    // Unix 秒
    scheduledAt: integer('scheduled_at'),
    durationMinutes: integer('duration_minutes'),
    priority: integer('priority').notNull().default(0),
    // Unix 秒;null = 未完成
    completedAt: integer('completed_at'),
    createdAt: integer('created_at').notNull(),
    parentTaskId: integer('parent_task_id').references((): AnySQLiteColumn => task.id),
    // 由重複規則產生的實例才有;規則刪除時實例留下,變回一般任務
    recurrenceRuleId: integer('recurrence_rule_id').references(
      (): AnySQLiteColumn => taskRecurrenceRule.id,
      { onDelete: 'set null' },
    ),
    // 日曆日,YYYY-MM-DD;這個實例對應規則展開出的哪一天。之後改 dueDate 也不變
    occurrenceDate: text('occurrence_date'),
    // 置頂:全域語意,在任何清單看都置頂(decisions §6d)。狀態本身就是布林值,沒有「何時」要記
    pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
    // Unix 秒;null = 建立後沒被編輯過;0 = 欄位上線前就存在的重複實例,是否編輯過未知(decisions §6a)
    editedAt: integer('edited_at'),
  },
  // 同一規則同一天只有一個實例:補齊重跑或並發時靠它擋重複。NULL 彼此相異,一般任務不受影響
  (table) => [
    uniqueIndex('task_recurrence_occurrence_uq').on(table.recurrenceRuleId, table.occurrenceDate),
  ],
)

// 任務底下的待辦項,不是任務:沒有截止日、不排程、不出現在任務清單裡。
// 任務刪除時一起刪掉
export const taskChecklistItem = sqliteTable(
  'task_checklist_item',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    taskId: integer('task_id')
      .notNull()
      .references(() => task.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    // 同一個任務內的順序,小的在前;不保證連號(刪除後不重編)
    position: integer('position').notNull(),
    // Unix 秒;null = 未勾。照 task.completedAt 的慣例,不用布林值
    completedAt: integer('completed_at'),
    // Unix 秒;沒有 schema 預設值,由 src/modules/tasks/server/ 填入(同 task.createdAt)
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  // 不設 unique:重新排序在 transaction 裡逐列寫,中途會有暫時重複的 position
  (table) => [index('task_checklist_item_task_position_idx').on(table.taskId, table.position)],
)

// 清單的呈現設定:分組與排序。描述的是「現在想怎麼看這個清單」,不是任務的屬性,
// 所以每個清單各存一份(decisions §6d)。沒有對應的列 = 用預設值(src/modules/tasks/lib/listView.ts)
export const taskListView = sqliteTable(
  'task_list_view',
  {
    // 清單的識別字。目前只有智慧檢視的 id(today / next7 / open / done);
    // 之後自訂清單用另一種前綴,不必改表
    listKey: text('list_key').primaryKey(),
    groupBy: text('group_by', { enum: ['none', 'date', 'priority'] }).notNull(),
    sortBy: text('sort_by', { enum: ['created', 'dueDate', 'priority', 'title'] }).notNull(),
    sortDirection: text('sort_direction', { enum: ['asc', 'desc'] }).notNull(),
    // Unix 秒;沒有 schema 預設值,由 src/modules/tasks/server/ 填入(同 task.createdAt)
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    check('task_list_view_group_by_check', sql`${table.groupBy} IN ('none', 'date', 'priority')`),
    check(
      'task_list_view_sort_by_check',
      sql`${table.sortBy} IN ('created', 'dueDate', 'priority', 'title')`,
    ),
    check('task_list_view_sort_direction_check', sql`${table.sortDirection} IN ('asc', 'desc')`),
  ],
)

// 重複規則:日曆規則 + 範本內容。實例是一般的 task 列,以 recurrenceRuleId 指回
export const taskRecurrenceRule = sqliteTable(
  'task_recurrence_rule',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    freq: text('freq', { enum: ['daily', 'weekly', 'monthly', 'yearly'] }).notNull(),
    interval: integer('interval').notNull(),
    // bitmask,bit 0 = 星期一 … bit 6 = 星期日;只有 weekly 使用
    weekdays: integer('weekdays'),
    // 日曆日,YYYY-MM-DD;展開的錨點
    startDate: text('start_date').notNull(),
    // 日曆日,YYYY-MM-DD;規則的結束日,含當天。null = 永不結束。
    // 和 endedAt 不同:這是規則的一部分,endedAt 是使用者中途停止
    until: text('until'),
    // 範本內容,型別與限制同 task
    title: text('title').notNull(),
    notes: text('notes'),
    priority: integer('priority').notNull().default(0),
    // 日曆日,YYYY-MM-DD;實例已產生到哪一天(水位線)。null = 尚未產生
    generatedThrough: text('generated_through'),
    // Unix 秒;null = 仍在重複
    endedAt: integer('ended_at'),
    // Unix 秒;沒有 schema 預設值,由 src/modules/tasks/server/ 填入(同 task.createdAt)
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    check('task_recurrence_rule_freq_check', sql`${table.freq} IN ('daily', 'weekly', 'monthly', 'yearly')`),
    check('task_recurrence_rule_interval_check', sql`${table.interval} >= 1`),
    check(
      'task_recurrence_rule_weekdays_check',
      sql`(${table.freq} = 'weekly' AND ${table.weekdays} BETWEEN 1 AND 127) OR (${table.freq} <> 'weekly' AND ${table.weekdays} IS NULL)`,
    ),
  ],
)

// 規則的範本 checklist:產生實例時複製成 task_checklist_item。範本不會被勾,所以沒有完成狀態
export const taskRecurrenceRuleChecklistItem = sqliteTable(
  'task_recurrence_rule_checklist_item',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ruleId: integer('rule_id')
      .notNull()
      .references(() => taskRecurrenceRule.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    // 同一條規則內的順序,小的在前;不保證連號
    position: integer('position').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('task_recurrence_rule_checklist_item_rule_position_idx').on(table.ruleId, table.position),
  ],
)

// 習慣:配額(每週期做幾次),不是日曆規則;和 task_recurrence_rule 是兩個獨立實體(decisions §6b)。
// periodType 與 target 是「現在的設定」的快取,歷史在 habit_settings_history
export const habit = sqliteTable(
  'habit',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    periodType: text('period_type', { enum: ['daily', 'weekly', 'monthly'] }).notNull(),
    // 每週期的目標次數;null = 紀錄型(只記錄,不判定達成,不算 streak)
    target: integer('target'),
    // 清單順序,小的在前;不保證連號
    sortOrder: integer('sort_order').notNull(),
    // HH:MM,可空;個別習慣提醒的時刻(decisions §6j)
    reminderTime: text('reminder_time'),
    // Unix 秒;沒有 schema 預設值,由 src/modules/tasks/server/ 填入(同 task.createdAt)
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    check('habit_period_type_check', sql`${table.periodType} IN ('daily', 'weekly', 'monthly')`),
    check('habit_target_check', sql`${table.target} IS NULL OR ${table.target} >= 1`),
  ],
)

// 完成一次 = 一列,不存週期累計數:回顧要看得到哪天做的
export const habitLog = sqliteTable(
  'habit_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    habitId: integer('habit_id')
      .notNull()
      .references(() => habit.id, { onDelete: 'cascade' }),
    // 日曆日,YYYY-MM-DD
    date: text('date').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [index('habit_log_habit_date_idx').on(table.habitId, table.date)],
)

// 週期與目標的變更歷史:每次改週期或改目標都追加完整的一筆。
// 歷史週期用當時的設定判定,不用現在的設定回頭重算
export const habitSettingsHistory = sqliteTable(
  'habit_settings_history',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    habitId: integer('habit_id')
      .notNull()
      .references(() => habit.id, { onDelete: 'cascade' }),
    periodType: text('period_type', { enum: ['daily', 'weekly', 'monthly'] }).notNull(),
    target: integer('target'),
    // 日曆日,YYYY-MM-DD;這筆設定從哪天起生效。同一天多筆時 id 大的較新
    effectiveFrom: text('effective_from').notNull(),
  },
  (table) => [
    check('habit_settings_history_period_type_check', sql`${table.periodType} IN ('daily', 'weekly', 'monthly')`),
    check('habit_settings_history_target_check', sql`${table.target} IS NULL OR ${table.target} >= 1`),
    index('habit_settings_history_habit_effective_idx').on(table.habitId, table.effectiveFrom),
  ],
)

// 停止區間。停止不建新實體:停止中 = 存在 endDate 為 null 的列
export const habitPause = sqliteTable(
  'habit_pause',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    habitId: integer('habit_id')
      .notNull()
      .references(() => habit.id, { onDelete: 'cascade' }),
    // 日曆日,YYYY-MM-DD;兩端都含當天
    startDate: text('start_date').notNull(),
    // null = 仍在停止中
    endDate: text('end_date'),
  },
  // 同一個習慣最多一段進行中的停止;並發的重複停止由它擋下
  (table) => [
    uniqueIndex('habit_pause_open_uq').on(table.habitId).where(sql`${table.endDate} IS NULL`),
  ],
)

// 三則每日摘要的設定。沒有列 = 用預設值(08:00 / 15:00 / 21:00,皆啟用),預設不落地
export const taskNotificationSetting = sqliteTable(
  'task_notification_setting',
  {
    kind: text('kind', { enum: ['morning', 'afternoon', 'evening'] }).primaryKey(),
    // HH:MM
    time: text('time').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull(),
    // Unix 秒;沒有 schema 預設值,由 src/modules/tasks/server/ 填入
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    check('task_notification_setting_kind_check', sql`${table.kind} IN ('morning', 'afternoon', 'evening')`),
  ],
)

// 每日已送出的通知標記。同一天同一則只送一次(decisions §6j)
export const taskNotificationSent = sqliteTable(
  'task_notification_sent',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    // 例如 summary:morning、habit:12
    key: text('key').notNull(),
    // 日曆日,YYYY-MM-DD
    date: text('date').notNull(),
    // Unix 秒;沒有 schema 預設值,由 src/modules/tasks/server/ 填入
    sentAt: integer('sent_at').notNull(),
  },
  (table) => [
    uniqueIndex('task_notification_sent_key_date_uq').on(table.key, table.date),
  ],
)
