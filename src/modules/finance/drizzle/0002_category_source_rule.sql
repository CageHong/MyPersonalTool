-- 手寫(取代 Drizzle Kit 產生的內容;schema 與 meta/0002_snapshot.json 仍是產生的)。
-- 變更:finance_transactions.category_source 的 CHECK 加 'rule'。
--
-- 為什麼不用產生的版本:SQLite 改 CHECK 要重建資料表。Drizzle Kit 產生的是
-- 「PRAGMA foreign_keys=OFF → 建新表 → DROP 舊表 → 改名」,但 migration 包在一個 transaction 裡,
-- transaction 裡的 PRAGMA foreign_keys 不生效;外鍵開著時 DROP TABLE 會先做隱含的 DELETE,
-- 觸發 finance_postings、finance_transaction_tags 的 ON DELETE CASCADE,分錄與標籤全被刪掉
-- (在真實資料的複本上試過:分錄全部消失)。
--
-- 做法:子表也一起重建,讓它們的外鍵先指向新表,再刪舊表(此時舊表沒有子表參照,不會連帶刪除),
-- 最後改名。改名時 SQLite 會把其他表外鍵裡的表名一起改掉。
-- 依賴分錄表的 view 與 trigger 要先刪、最後重建(DROP TABLE 會一起刪掉 trigger 與索引)。

DROP VIEW `finance_v_unbalanced`;
--> statement-breakpoint
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
	CONSTRAINT "finance_transactions_source_ck" CHECK(`source` IN ('wise_csv','manual','migration','scheduled')),
	CONSTRAINT "finance_transactions_category_source_ck" CHECK(`category_source` IN ('legacy','scheduled','rule','payee_history','source_category','correction'))
);
--> statement-breakpoint
INSERT INTO `__new_finance_transactions` SELECT `id`, `occurred_at`, `payee_id`, `note`, `source`, `external_id`, `scheduled_id`, `import_meta`, `category_source`, `created_at`, `updated_at` FROM `finance_transactions`;
--> statement-breakpoint
CREATE TABLE `__new_finance_postings` (
	`id` integer PRIMARY KEY NOT NULL,
	`transaction_id` integer NOT NULL,
	`account_id` integer NOT NULL,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`memo` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `__new_finance_transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `finance_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`currency`) REFERENCES `finance_currencies`(`code`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "finance_postings_amount_ck" CHECK(`amount` <> 0)
);
--> statement-breakpoint
INSERT INTO `__new_finance_postings` SELECT `id`, `transaction_id`, `account_id`, `amount`, `currency`, `memo`, `sort_order` FROM `finance_postings`;
--> statement-breakpoint
CREATE TABLE `__new_finance_transaction_tags` (
	`transaction_id` integer NOT NULL,
	`tag_id` integer NOT NULL,
	PRIMARY KEY(`transaction_id`, `tag_id`),
	FOREIGN KEY (`transaction_id`) REFERENCES `__new_finance_transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `finance_tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_finance_transaction_tags` SELECT `transaction_id`, `tag_id` FROM `finance_transaction_tags`;
--> statement-breakpoint
DROP TABLE `finance_postings`;
--> statement-breakpoint
DROP TABLE `finance_transaction_tags`;
--> statement-breakpoint
DROP TABLE `finance_transactions`;
--> statement-breakpoint
ALTER TABLE `__new_finance_transactions` RENAME TO `finance_transactions`;
--> statement-breakpoint
ALTER TABLE `__new_finance_postings` RENAME TO `finance_postings`;
--> statement-breakpoint
ALTER TABLE `__new_finance_transaction_tags` RENAME TO `finance_transaction_tags`;
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_transactions_external_id_unique` ON `finance_transactions` (`external_id`);
--> statement-breakpoint
CREATE INDEX `finance_transactions_occurred_idx` ON `finance_transactions` (`occurred_at`);
--> statement-breakpoint
CREATE INDEX `finance_transactions_payee_idx` ON `finance_transactions` (`payee_id`);
--> statement-breakpoint
CREATE INDEX `finance_transactions_scheduled_idx` ON `finance_transactions` (`scheduled_id`);
--> statement-breakpoint
CREATE INDEX `finance_postings_tx_idx` ON `finance_postings` (`transaction_id`);
--> statement-breakpoint
CREATE INDEX `finance_postings_account_idx` ON `finance_postings` (`account_id`);
--> statement-breakpoint
CREATE TRIGGER `finance_postings_currency_insert_chk`
BEFORE INSERT ON `finance_postings`
FOR EACH ROW
WHEN (SELECT currency FROM finance_accounts WHERE id = NEW.account_id) IS NOT NULL
 AND (SELECT currency FROM finance_accounts WHERE id = NEW.account_id) <> NEW.currency
BEGIN
    SELECT RAISE(ABORT, 'posting currency does not match account currency');
END;
--> statement-breakpoint
CREATE TRIGGER `finance_postings_currency_update_chk`
BEFORE UPDATE OF `account_id`, `currency` ON `finance_postings`
FOR EACH ROW
WHEN (SELECT currency FROM finance_accounts WHERE id = NEW.account_id) IS NOT NULL
 AND (SELECT currency FROM finance_accounts WHERE id = NEW.account_id) <> NEW.currency
BEGIN
    SELECT RAISE(ABORT, 'posting currency does not match account currency');
END;
--> statement-breakpoint
CREATE VIEW `finance_v_unbalanced` AS SELECT transaction_id, currency, SUM(amount) AS residual FROM finance_postings GROUP BY transaction_id, currency HAVING SUM(amount) <> 0;
