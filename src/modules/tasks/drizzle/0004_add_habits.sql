CREATE TABLE `habit` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`period_type` text NOT NULL,
	`target` integer,
	`sort_order` integer NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "habit_period_type_check" CHECK("habit"."period_type" IN ('daily', 'weekly', 'monthly')),
	CONSTRAINT "habit_target_check" CHECK("habit"."target" IS NULL OR "habit"."target" >= 1)
);
--> statement-breakpoint
CREATE TABLE `habit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`habit_id` integer NOT NULL,
	`date` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`habit_id`) REFERENCES `habit`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `habit_log_habit_date_idx` ON `habit_log` (`habit_id`,`date`);--> statement-breakpoint
CREATE TABLE `habit_pause` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`habit_id` integer NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text,
	FOREIGN KEY (`habit_id`) REFERENCES `habit`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `habit_pause_open_uq` ON `habit_pause` (`habit_id`) WHERE "habit_pause"."end_date" IS NULL;--> statement-breakpoint
CREATE TABLE `habit_settings_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`habit_id` integer NOT NULL,
	`period_type` text NOT NULL,
	`target` integer,
	`effective_from` text NOT NULL,
	FOREIGN KEY (`habit_id`) REFERENCES `habit`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "habit_settings_history_period_type_check" CHECK("habit_settings_history"."period_type" IN ('daily', 'weekly', 'monthly')),
	CONSTRAINT "habit_settings_history_target_check" CHECK("habit_settings_history"."target" IS NULL OR "habit_settings_history"."target" >= 1)
);
--> statement-breakpoint
CREATE INDEX `habit_settings_history_habit_effective_idx` ON `habit_settings_history` (`habit_id`,`effective_from`);