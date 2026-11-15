CREATE TABLE `finance_deleted_external_ids` (
	`external_id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`deleted_at` text NOT NULL,
	`snapshot` text NOT NULL
);
