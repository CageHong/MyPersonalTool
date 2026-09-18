import { index, sqliteTable, integer, text } from 'drizzle-orm/sqlite-core'
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'

export const task = sqliteTable('task', {
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
})

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
    // Unix 秒;沒有 schema 預設值,由 src/server/ 填入(同 task.createdAt)
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  // 不設 unique:重新排序在 transaction 裡逐列寫,中途會有暫時重複的 position
  (table) => [index('task_checklist_item_task_position_idx').on(table.taskId, table.position)],
)
