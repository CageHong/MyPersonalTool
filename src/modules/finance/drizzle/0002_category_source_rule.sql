PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_finance_transactions` (
	`id` integer PRIMARY KEY NOT NULL,
	`occurred_at` text NOT NULL,
	`payee_id` integer,
	`note` text,
	`source` text NOT NULL,
	`external_id` text,
	`scheduled_id` integer,
	`import_meta` text,
	`category_source` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`payee_id`) REFERENCES `finance_payees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`scheduled_id`) REFERENCES `finance_scheduled_transactions`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "finance_transactions_source_ck" CHECK("__new_finance_transactions"."source" IN ('wise_csv','manual','migration','scheduled')),
	CONSTRAINT "finance_transactions_category_source_ck" CHECK("__new_finance_transactions"."category_source" IN ('legacy','scheduled','rule','payee_history','source_category','correction'))
);
--> statement-breakpoint
INSERT INTO `__new_finance_transactions`("id", "occurred_at", "payee_id", "note", "source", "external_id", "scheduled_id", "import_meta", "category_source", "created_at", "updated_at") SELECT "id", "occurred_at", "payee_id", "note", "source", "external_id", "scheduled_id", "import_meta", "category_source", "created_at", "updated_at" FROM `finance_transactions`;--> statement-breakpoint
DROP TABLE `finance_transactions`;--> statement-breakpoint
ALTER TABLE `__new_finance_transactions` RENAME TO `finance_transactions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `finance_transactions_external_id_unique` ON `finance_transactions` (`external_id`);--> statement-breakpoint
CREATE INDEX `finance_transactions_occurred_idx` ON `finance_transactions` (`occurred_at`);--> statement-breakpoint
CREATE INDEX `finance_transactions_payee_idx` ON `finance_transactions` (`payee_id`);--> statement-breakpoint
CREATE INDEX `finance_transactions_scheduled_idx` ON `finance_transactions` (`scheduled_id`);