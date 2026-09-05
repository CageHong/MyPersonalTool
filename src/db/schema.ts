import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core'
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
