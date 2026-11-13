CREATE TABLE `finance_account_groups` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`currency` text,
	`color` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`currency`) REFERENCES `finance_currencies`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_account_groups_name_unique` ON `finance_account_groups` (`name`);--> statement-breakpoint
CREATE TABLE `finance_accounts` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`subtype` text,
	`parent_id` integer,
	`currency` text,
	`group_id` integer,
	`color` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`is_system` integer DEFAULT false NOT NULL,
	`legacy_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `finance_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`currency`) REFERENCES `finance_currencies`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`group_id`) REFERENCES `finance_account_groups`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "finance_accounts_type_ck" CHECK("finance_accounts"."type" IN ('asset','liability','equity','income','expense')),
	CONSTRAINT "finance_accounts_currency_ck" CHECK("finance_accounts"."type" NOT IN ('asset','liability') OR "finance_accounts"."currency" IS NOT NULL),
	CONSTRAINT "finance_accounts_group_ck" CHECK("finance_accounts"."group_id" IS NULL OR "finance_accounts"."type" IN ('asset','liability')),
	CONSTRAINT "finance_accounts_is_active_ck" CHECK("finance_accounts"."is_active" IN (0,1)),
	CONSTRAINT "finance_accounts_is_system_ck" CHECK("finance_accounts"."is_system" IN (0,1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_accounts_legacy_id_unique` ON `finance_accounts` (`legacy_id`);--> statement-breakpoint
CREATE TABLE `finance_credit_card_details` (
	`account_id` integer PRIMARY KEY NOT NULL,
	`credit_limit` integer,
	`balance_display` text DEFAULT 'balance' NOT NULL,
	`statement_day` integer,
	`due_day` integer,
	`due_days_after_statement` integer,
	FOREIGN KEY (`account_id`) REFERENCES `finance_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "finance_credit_card_details_limit_ck" CHECK("finance_credit_card_details"."credit_limit" > 0),
	CONSTRAINT "finance_credit_card_details_display_ck" CHECK("finance_credit_card_details"."balance_display" IN ('balance','available')),
	CONSTRAINT "finance_credit_card_details_statement_ck" CHECK("finance_credit_card_details"."statement_day" BETWEEN 1 AND 31),
	CONSTRAINT "finance_credit_card_details_due_day_ck" CHECK("finance_credit_card_details"."due_day" BETWEEN 1 AND 31),
	CONSTRAINT "finance_credit_card_details_due_after_ck" CHECK("finance_credit_card_details"."due_days_after_statement" >= 1),
	CONSTRAINT "finance_credit_card_details_due_one_ck" CHECK("finance_credit_card_details"."due_day" IS NULL OR "finance_credit_card_details"."due_days_after_statement" IS NULL)
);
--> statement-breakpoint
CREATE TABLE `finance_currencies` (
	`code` text PRIMARY KEY NOT NULL,
	`exponent` integer NOT NULL,
	`name` text NOT NULL,
	CONSTRAINT "finance_currencies_exponent_ck" CHECK("finance_currencies"."exponent" BETWEEN 0 AND 4)
);
--> statement-breakpoint
CREATE TABLE `finance_fx_direct_quotes` (
	`date` text NOT NULL,
	`base` text NOT NULL,
	`quote` text NOT NULL,
	`rate` real NOT NULL,
	`source` text NOT NULL,
	`fetched_at` text NOT NULL,
	PRIMARY KEY(`date`, `base`, `quote`),
	FOREIGN KEY (`base`) REFERENCES `finance_currencies`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`quote`) REFERENCES `finance_currencies`(`code`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "finance_fx_direct_quotes_direction_ck" CHECK("finance_fx_direct_quotes"."base" < "finance_fx_direct_quotes"."quote"),
	CONSTRAINT "finance_fx_direct_quotes_rate_ck" CHECK("finance_fx_direct_quotes"."rate" > 0)
);
--> statement-breakpoint
CREATE TABLE `finance_fx_rates` (
	`date` text NOT NULL,
	`currency` text NOT NULL,
	`rate_to_eur` real NOT NULL,
	`source` text NOT NULL,
	`fetched_at` text NOT NULL,
	PRIMARY KEY(`date`, `currency`),
	FOREIGN KEY (`currency`) REFERENCES `finance_currencies`(`code`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "finance_fx_rates_rate_ck" CHECK("finance_fx_rates"."rate_to_eur" > 0)
);
--> statement-breakpoint
CREATE TABLE `finance_payee_aliases` (
	`alias` text PRIMARY KEY NOT NULL,
	`payee_id` integer NOT NULL,
	FOREIGN KEY (`payee_id`) REFERENCES `finance_payees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `finance_payee_aliases_payee_idx` ON `finance_payee_aliases` (`payee_id`);--> statement-breakpoint
CREATE TABLE `finance_payees` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_payees_name_unique` ON `finance_payees` (`name`);--> statement-breakpoint
CREATE TABLE `finance_postings` (
	`id` integer PRIMARY KEY NOT NULL,
	`transaction_id` integer NOT NULL,
	`account_id` integer NOT NULL,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`memo` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `finance_transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `finance_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`currency`) REFERENCES `finance_currencies`(`code`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "finance_postings_amount_ck" CHECK("finance_postings"."amount" <> 0)
);
--> statement-breakpoint
CREATE INDEX `finance_postings_tx_idx` ON `finance_postings` (`transaction_id`);--> statement-breakpoint
CREATE INDEX `finance_postings_account_idx` ON `finance_postings` (`account_id`);--> statement-breakpoint
CREATE TABLE `finance_rules` (
	`id` integer PRIMARY KEY NOT NULL,
	`match_field` text NOT NULL,
	`payee_id` integer,
	`match_value` text,
	`assign_account_id` integer,
	`assign_tags` text DEFAULT '[]' NOT NULL,
	`priority` integer DEFAULT 10 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`payee_id`) REFERENCES `finance_payees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assign_account_id`) REFERENCES `finance_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "finance_rules_match_ck" CHECK(("finance_rules"."match_field" = 'payee' AND "finance_rules"."payee_id" IS NOT NULL AND "finance_rules"."match_value" IS NULL) OR ("finance_rules"."match_field" = 'source_category' AND "finance_rules"."payee_id" IS NULL AND "finance_rules"."match_value" IS NOT NULL)),
	CONSTRAINT "finance_rules_is_active_ck" CHECK("finance_rules"."is_active" IN (0,1))
);
--> statement-breakpoint
CREATE INDEX `finance_rules_payee_idx` ON `finance_rules` (`payee_id`);--> statement-breakpoint
CREATE TABLE `finance_scheduled_transactions` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`account_id` integer NOT NULL,
	`payee_id` integer NOT NULL,
	`amount_min` integer NOT NULL,
	`amount_max` integer NOT NULL,
	`currency` text NOT NULL,
	`frequency` text NOT NULL,
	`interval` integer DEFAULT 1 NOT NULL,
	`starts_on` text,
	`ends_on` text,
	`note` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `finance_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payee_id`) REFERENCES `finance_payees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`currency`) REFERENCES `finance_currencies`(`code`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "finance_scheduled_transactions_min_ck" CHECK("finance_scheduled_transactions"."amount_min" >= 0),
	CONSTRAINT "finance_scheduled_transactions_max_ck" CHECK("finance_scheduled_transactions"."amount_max" >= "finance_scheduled_transactions"."amount_min"),
	CONSTRAINT "finance_scheduled_transactions_frequency_ck" CHECK("finance_scheduled_transactions"."frequency" IN ('weekly','monthly','yearly')),
	CONSTRAINT "finance_scheduled_transactions_interval_ck" CHECK("finance_scheduled_transactions"."interval" >= 1),
	CONSTRAINT "finance_scheduled_transactions_is_active_ck" CHECK("finance_scheduled_transactions"."is_active" IN (0,1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_scheduled_transactions_name_unique` ON `finance_scheduled_transactions` (`name`);--> statement-breakpoint
CREATE TABLE `finance_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `finance_tags` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`starts_on` text,
	`ends_on` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_tags_name_unique` ON `finance_tags` (`name`);--> statement-breakpoint
CREATE TABLE `finance_transaction_tags` (
	`transaction_id` integer NOT NULL,
	`tag_id` integer NOT NULL,
	PRIMARY KEY(`transaction_id`, `tag_id`),
	FOREIGN KEY (`transaction_id`) REFERENCES `finance_transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `finance_tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `finance_transactions` (
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
	CONSTRAINT "finance_transactions_source_ck" CHECK("finance_transactions"."source" IN ('wise_csv','manual','migration','scheduled')),
	CONSTRAINT "finance_transactions_category_source_ck" CHECK("finance_transactions"."category_source" IN ('legacy','scheduled','payee_history','source_category','correction'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_transactions_external_id_unique` ON `finance_transactions` (`external_id`);--> statement-breakpoint
CREATE INDEX `finance_transactions_occurred_idx` ON `finance_transactions` (`occurred_at`);--> statement-breakpoint
CREATE INDEX `finance_transactions_payee_idx` ON `finance_transactions` (`payee_id`);--> statement-breakpoint
CREATE INDEX `finance_transactions_scheduled_idx` ON `finance_transactions` (`scheduled_id`);--> statement-breakpoint
CREATE VIEW `finance_v_unbalanced` AS SELECT transaction_id, currency, SUM(amount) AS residual FROM finance_postings GROUP BY transaction_id, currency HAVING SUM(amount) <> 0;