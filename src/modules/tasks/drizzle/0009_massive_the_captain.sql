CREATE TABLE `task_reminder` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_id` integer,
	`rule_id` integer,
	`habit_id` integer,
	`kind` text NOT NULL,
	`time` text NOT NULL,
	`days_before` integer,
	`date` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`rule_id`) REFERENCES `task_recurrence_rule`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`habit_id`) REFERENCES `habit`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "task_reminder_owner_check" CHECK((("task_reminder"."task_id" IS NOT NULL) + ("task_reminder"."rule_id" IS NOT NULL) + ("task_reminder"."habit_id" IS NOT NULL)) = 1),
	CONSTRAINT "task_reminder_kind_check" CHECK("task_reminder"."kind" IN ('daily', 'relative', 'absolute'))
);
--> statement-breakpoint
CREATE INDEX `task_reminder_task_idx` ON `task_reminder` (`task_id`);--> statement-breakpoint
CREATE INDEX `task_reminder_rule_idx` ON `task_reminder` (`rule_id`);--> statement-breakpoint
CREATE INDEX `task_reminder_habit_idx` ON `task_reminder` (`habit_id`);--> statement-breakpoint
ALTER TABLE `habit` ADD `exclude_from_summary` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `task` ADD `exclude_from_summary` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `task_recurrence_rule` ADD `exclude_from_summary` integer DEFAULT false NOT NULL;