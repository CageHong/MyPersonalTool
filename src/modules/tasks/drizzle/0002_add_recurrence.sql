CREATE TABLE `task_recurrence_rule` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`freq` text NOT NULL,
	`interval` integer NOT NULL,
	`weekdays` integer,
	`start_date` text NOT NULL,
	`title` text NOT NULL,
	`notes` text,
	`priority` integer DEFAULT 0 NOT NULL,
	`generated_through` text,
	`ended_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "task_recurrence_rule_freq_check" CHECK("task_recurrence_rule"."freq" IN ('daily', 'weekly', 'monthly', 'yearly')),
	CONSTRAINT "task_recurrence_rule_interval_check" CHECK("task_recurrence_rule"."interval" >= 1),
	CONSTRAINT "task_recurrence_rule_weekdays_check" CHECK(("task_recurrence_rule"."freq" = 'weekly' AND "task_recurrence_rule"."weekdays" BETWEEN 1 AND 127) OR ("task_recurrence_rule"."freq" <> 'weekly' AND "task_recurrence_rule"."weekdays" IS NULL))
);
--> statement-breakpoint
CREATE TABLE `task_recurrence_rule_checklist_item` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`rule_id` integer NOT NULL,
	`title` text NOT NULL,
	`position` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`rule_id`) REFERENCES `task_recurrence_rule`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `task_recurrence_rule_checklist_item_rule_position_idx` ON `task_recurrence_rule_checklist_item` (`rule_id`,`position`);--> statement-breakpoint
-- ON DELETE set null 是手動補的:drizzle-kit 產生加欄位附外鍵的 ALTER 時會漏掉 onDelete
ALTER TABLE `task` ADD `recurrence_rule_id` integer REFERENCES task_recurrence_rule(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `task` ADD `occurrence_date` text;--> statement-breakpoint
CREATE UNIQUE INDEX `task_recurrence_occurrence_uq` ON `task` (`recurrence_rule_id`,`occurrence_date`);