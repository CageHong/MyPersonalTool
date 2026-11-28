// 必須是第一個 import:在 db 連線建立前切到記憶體資料庫
import '../test/setup'
// 最新的 migration 不會弄丟資料:套用前後每張表的筆數相同、外鍵都指得到資料。
// 種子照「倒數第二版」的 schema 寫(內容都是虛構的);migration 改到這裡用到的欄位時跟著更新。
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { runMigrations } from '../../../platform/migrations'
import { checkNewestMigration } from '../../../platform/testing/migrationCheck'
import { MIGRATIONS_FOLDER } from './index'

const SEED = `
INSERT INTO task_recurrence_rule (id, freq, interval, weekdays, start_date, title, created_at, updated_at)
  VALUES (1, 'weekly', 1, 1, '2030-01-01', 'Water plants', 0, 0);
INSERT INTO task_recurrence_rule_checklist_item (rule_id, title, position, created_at, updated_at)
  VALUES (1, 'Balcony', 0, 0, 0);
INSERT INTO task (id, title, created_at, recurrence_rule_id, occurrence_date) VALUES
  (1, 'Water plants', 0, 1, '2030-01-01');
INSERT INTO task (id, title, created_at, parent_task_id) VALUES (2, 'Buy soil', 0, 1);
INSERT INTO task_checklist_item (task_id, title, position, created_at, updated_at) VALUES (1, 'Kitchen', 0, 0, 0);
INSERT INTO habit (id, name, period_type, target, sort_order, created_at) VALUES (1, 'Read', 'weekly', 3, 0, 0);
INSERT INTO habit_log (habit_id, date, created_at) VALUES (1, '2030-01-02', 0);
INSERT INTO habit_pause (habit_id, start_date) VALUES (1, '2030-02-01');
INSERT INTO habit_settings_history (habit_id, period_type, target, effective_from) VALUES (1, 'weekly', 3, '2030-01-01');
INSERT INTO task_list_view (list_key, group_by, sort_by, sort_direction, updated_at) VALUES ('today', 'date', 'created', 'asc', 0);
INSERT INTO task_notification_setting (kind, time, enabled, updated_at) VALUES ('morning', '08:00', 1, 0);
INSERT INTO task_notification_sent (key, date, sent_at) VALUES ('summary:morning', '2030-01-01', 0);
INSERT INTO task_reminder (habit_id, kind, time, created_at, updated_at) VALUES (1, 'daily', '09:00', 0, 0);
`

test('最新的 migration 保留所有資料', () => {
  const result = checkNewestMigration(MIGRATIONS_FOLDER, (sqlite) => sqlite.exec(SEED))
  assert.ok(result.newest)
  for (const [table, n] of Object.entries(result.before)) {
    if (table === 'sqlite_sequence') continue
    assert.ok(n > 0, `種子沒有灌到 ${table}`)
  }
  assert.deepEqual(result.changed, [])
  assert.deepEqual(result.violations, [])
})

test('舊版 habit.reminder_time 會搬進 task_reminder 並移除舊欄位', () => {
  const journalPath = join(MIGRATIONS_FOLDER, 'meta', '_journal.json')
  const journal = JSON.parse(readFileSync(journalPath, 'utf-8')) as { entries: { tag: string }[] }
  const idx0008 = journal.entries.findIndex((e) => e.tag.startsWith('0008_'))
  assert.ok(idx0008 >= 0)

  const beforeDir = mkdtempSync(join(tmpdir(), 'migration-reminder-'))
  try {
    cpSync(MIGRATIONS_FOLDER, beforeDir, { recursive: true })
    writeFileSync(
      join(beforeDir, 'meta', '_journal.json'),
      JSON.stringify({ ...journal, entries: journal.entries.slice(0, idx0008 + 1) }),
    )

    const sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')
    const memDb = drizzle(sqlite)
    runMigrations(memDb, beforeDir)

    sqlite.exec(`
      INSERT INTO habit (id, name, period_type, target, sort_order, reminder_time, created_at)
        VALUES (1, 'Read', 'weekly', 3, 0, '09:00', 0),
               (2, 'Stretch', 'daily', 1, 1, NULL, 0);
      INSERT INTO habit_log (habit_id, date, created_at) VALUES (1, '2030-01-02', 0);
      INSERT INTO habit_pause (habit_id, start_date) VALUES (1, '2030-02-01');
      INSERT INTO habit_settings_history (habit_id, period_type, target, effective_from) VALUES (1, 'weekly', 3, '2030-01-01');
    `)

    runMigrations(memDb, MIGRATIONS_FOLDER)

    const reminders = sqlite
      .prepare('SELECT habit_id, task_id, rule_id, kind, time, days_before, date FROM task_reminder')
      .all()
    assert.deepEqual(reminders, [
      { habit_id: 1, task_id: null, rule_id: null, kind: 'daily', time: '09:00', days_before: null, date: null },
    ])

    const habitCols = sqlite.prepare('PRAGMA table_info(habit)').all() as { name: string }[]
    assert.ok(!habitCols.some((c) => c.name === 'reminder_time'))
    assert.equal((sqlite.prepare('SELECT COUNT(*) AS n FROM habit_log').get() as { n: number }).n, 1)
    assert.equal((sqlite.prepare('SELECT COUNT(*) AS n FROM habit_pause').get() as { n: number }).n, 1)
    assert.equal((sqlite.prepare('SELECT COUNT(*) AS n FROM habit_settings_history').get() as { n: number }).n, 1)
    assert.deepEqual(sqlite.pragma('foreign_key_check'), [])
    sqlite.close()
  } finally {
    rmSync(beforeDir, { recursive: true, force: true })
  }
})
