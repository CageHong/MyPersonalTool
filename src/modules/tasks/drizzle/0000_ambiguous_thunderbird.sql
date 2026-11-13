CREATE TABLE `task` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`notes` text,
	`due_date` text,
	`due_time` text,
	`scheduled_at` integer,
	`duration_minutes` integer,
	`priority` integer DEFAULT 0 NOT NULL,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`parent_task_id` integer,
	FOREIGN KEY (`parent_task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE no action
);
