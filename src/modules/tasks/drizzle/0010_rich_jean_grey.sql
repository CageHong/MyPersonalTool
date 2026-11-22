INSERT INTO `task_reminder` (`habit_id`, `kind`, `time`, `created_at`, `updated_at`)
SELECT `id`, 'daily', `reminder_time`, CAST(strftime('%s', 'now') AS integer), CAST(strftime('%s', 'now') AS integer)
FROM `habit`
WHERE `reminder_time` IS NOT NULL;
