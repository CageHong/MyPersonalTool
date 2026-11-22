CREATE TABLE `task_notification_sent` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`date` text NOT NULL,
	`sent_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_notification_sent_key_date_uq` ON `task_notification_sent` (`key`,`date`);--> statement-breakpoint
CREATE TABLE `task_notification_setting` (
	`kind` text PRIMARY KEY NOT NULL,
	`time` text NOT NULL,
	`enabled` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "task_notification_setting_kind_check" CHECK("task_notification_setting"."kind" IN ('morning', 'afternoon', 'evening'))
);
--> statement-breakpoint
ALTER TABLE `habit` ADD `reminder_time` text;