-- 手寫:Drizzle Kit 產生不出來的限制。

-- 同類型、同一層內帳戶名稱不重複(最上層的 parent_id 是 NULL,用 0 代替才比得出重複)
CREATE UNIQUE INDEX `finance_accounts_name_uq`
    ON `finance_accounts` (`type`, COALESCE(`parent_id`, 0), `name`);
--> statement-breakpoint
-- 帳戶有固定幣別時,分錄幣別必須相同
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
