CREATE TABLE `task_list_view` (
	`list_key` text PRIMARY KEY NOT NULL,
	`group_by` text NOT NULL,
	`sort_by` text NOT NULL,
	`sort_direction` text NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "task_list_view_group_by_check" CHECK("task_list_view"."group_by" IN ('none', 'date', 'priority')),
	CONSTRAINT "task_list_view_sort_by_check" CHECK("task_list_view"."sort_by" IN ('created', 'dueDate', 'priority', 'title')),
	CONSTRAINT "task_list_view_sort_direction_check" CHECK("task_list_view"."sort_direction" IN ('asc', 'desc'))
);
--> statement-breakpoint
ALTER TABLE `task` ADD `pinned` integer DEFAULT false NOT NULL;