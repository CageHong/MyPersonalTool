-- 欄位上線前既有的未完成重複實例（occurrence_date <= 本地今天），edited_at 設成 0（是否編輯過未知，跳過時先保留）
UPDATE `task`
SET `edited_at` = 0
WHERE `recurrence_rule_id` IS NOT NULL
  AND `completed_at` IS NULL
  AND `occurrence_date` <= date('now', 'localtime');
