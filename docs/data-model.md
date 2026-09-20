# 資料模型

欄位表、時間處理規則,以及伺服器端的領域規則。**動到 schema、migration 或 `src/server/` 的計算邏輯前讀這一份。**

事實來源是 `src/db/schema.ts` 與 `src/server/`;本檔與程式碼不一致時以程式碼為準,並在同一次修改裡更新本檔。

決策理由見 `docs/decisions.md` §2、§6a、§6b。

## `task`

一列 = 一個具體的任務實例,不是重複規則。

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `id` | integer PK autoincrement | 否 | |
| `title` | text | 否 | |
| `notes` | text | 是 | 描述 |
| `dueDate` | text `YYYY-MM-DD` | 是 | 日曆日,**不是**時間戳 |
| `dueTime` | text `HH:MM` | 是 | 有指定時刻才填 |
| `scheduledAt` | integer (Unix 秒) | 是 | 打算執行的時刻 |
| `durationMinutes` | integer | 是 | 預估長度 |
| `priority` | integer 預設 0 | 否 | |
| `completedAt` | integer (Unix 秒) | 是 | `null` = 未完成 |
| `createdAt` | integer (Unix 秒) | 否 | |
| `parentTaskId` | integer FK → `task.id` | 是 | 子任務;本輪不做 UI |
| `recurrenceRuleId` | integer FK → `task_recurrence_rule.id`,ON DELETE SET NULL | 是 | 重複規則產生的實例才有 |
| `occurrenceDate` | text `YYYY-MM-DD` | 是 | 這個實例對應規則展開的哪一天;`(recurrenceRuleId, occurrenceDate)` UNIQUE |

### 時間處理規則

- 絕對瞬間一律存 **Unix 秒數整數**(`createdAt`、`completedAt`、`scheduledAt`)。
- `dueDate` 是**日曆日**,存文字 `YYYY-MM-DD`,不要轉成時間戳(理由見 `docs/decisions.md` §2)。
- `dueDate`、`startDate` 必須是真實存在的日曆日(`isCalendarDate`,在 `src/server/validation.ts`);`2026-02-30` 這種形狀合法但不存在的日期回 `invalid_format`。
- `dueTime` 與 `dueDate` 分開,因為「9/10 到期」和「9/10 15:00 到期」語意不同。
- `durationMinutes` 是長度不是時刻,存分鐘數。
- 完成狀態用 `completedAt` 判斷,**不要**加布林欄位(理由見 `docs/decisions.md` §2)。
- `createdAt` 在 schema 層**沒有**預設值,由 `src/server/` 的建立函式填入 `Math.floor(Date.now() / 1000)`。理由:那是業務規則,不放資料層。

### 更新規則(`updateTask`)

- 完成狀態收 `done: boolean`,不收 `completedAt`(收到回 `VALIDATION_FAILED`,`fields.completedAt`)。冪等規則同 checklist 項目:未完成時收到 `done: true` → 寫入當下時間;已完成時收到 `done: true` → 保留原值;`done: false` → `null`,已經是 `null` 就不變。
- 其他欄位新值與現有值相同時視為沒有變化(`title` 比 trim 後的值,`priority` 的 `null` 視為 0)。
- 整個 patch 都沒有實際變化時不寫入資料庫。task 表沒有 `updatedAt`。

### `priority` 的語意

- 值域固定為 0 / 1 / 3 / 5,對映 無 / 低 / 中 / 高。數字大 = 重要。
- 刻意留空隙(2、4 不用),之後插一級不需要改既有資料。
- 資料庫欄位是 NOT NULL DEFAULT 0。應用層接受 null,但在 `src/server/` 正規化成 0 再寫入;`createTask` 未傳時同樣填 0。

## `task_checklist_item`

任務底下的待辦項,**不是**任務——沒有截止日、不排程、不出現在任務清單查詢裡。

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `id` | integer PK autoincrement | 否 | |
| `taskId` | integer FK → `task.id`,ON DELETE CASCADE | 否 | 刪除任務時項目一起刪除 |
| `title` | text | 否 | |
| `position` | integer | 否 | 同一任務內的順序,小的在前;不保證連號 |
| `completedAt` | integer (Unix 秒) | 是 | `null` = 未勾 |
| `createdAt` | integer (Unix 秒) | 否 | |
| `updatedAt` | integer (Unix 秒) | 否 | |

完成狀態的冪等規則(函式收 `done: boolean`,只在 `src/server/` 轉換):

- 未勾時收到 `done: true` → 寫入當下時間;已勾時收到 `done: true` → 保留原值。
- `done: false` → `null`;已經是 `null` 就不變。
- 狀態沒有實際變化時,不更新 `updatedAt`。

## 重複任務

### `task_recurrence_rule`

重複規則:日曆規則 + 範本內容;實例是一般的 `task` 列,以 `recurrenceRuleId` 指回。

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `id` | integer PK autoincrement | 否 | |
| `freq` | text | 否 | `daily` / `weekly` / `monthly` / `yearly`,CHECK |
| `interval` | integer | 否 | CHECK `>= 1` |
| `weekdays` | integer | 是 | bitmask,bit 0 = 星期一 … bit 6 = 星期日;`weekly` 時必須 1..127,其他必須 NULL(CHECK) |
| `startDate` | text `YYYY-MM-DD` | 否 | 展開的錨點 |
| `until` | text `YYYY-MM-DD` | 是 | 結束日,含當天;`null` = 永不結束。必須是真實日曆日且 `>= startDate`,可以早於今天;到期不自動寫 `endedAt` |
| `title` / `notes` / `priority` | 同 `task` | | 範本內容 |
| `generatedThrough` | text `YYYY-MM-DD` | 是 | 水位線:實例已產生到哪一天;`null` = 尚未產生 |
| `endedAt` | integer (Unix 秒) | 是 | `null` = 仍在重複 |
| `createdAt` / `updatedAt` | integer (Unix 秒) | 否 | 水位線前進不更新 `updatedAt` |

### `task_recurrence_rule_checklist_item`

規則的範本 checklist,產生實例時複製成 `task_checklist_item`,全部未勾。

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `id` | integer PK autoincrement | 否 | |
| `ruleId` | integer FK → `task_recurrence_rule.id`,ON DELETE CASCADE | 否 | |
| `title` | text | 否 | |
| `position` | integer | 否 | 同 `task_checklist_item` |
| `createdAt` / `updatedAt` | integer (Unix 秒) | 否 | |

### 領域規則

函式在 `src/server/recurrence.ts`,日期展開 `expandRule` 在 `src/lib/recurrence.ts`。

- 用到「今天」的函式都以參數接收 `today`,不在函式內讀時鐘;`listTasks()` 查詢前以伺服器本地時區的今天呼叫 `fillInstances`。
- 補齊終點 = 今天 + 6(含),對上「未來 7 天」檢視。
- 建立規則時不回溯:原任務是第一個實例,水位線設為 max(第一個日期, 昨天),規則建立前的日期不產生實例。
- 停止重複可逆:任務的規則已停止時 `createRuleFromTask` 允許建新規則,任務改指向新規則;舊規則與它的其他實例不動。規則仍在進行中才回 `already_set`。
- 改規則(`updateRule`)與停止(`stopRule`)先用舊規則補到最新,再刪除今天之後、未完成的實例。

## 習慣

習慣是配額(每週期做幾次),和重複任務(日曆規則)是兩個獨立實體,不共用表(理由見 `docs/decisions.md` §6b)。純函式在 `src/lib/habit.ts`(`periodStart`、`settingsAt`、`progressOf`、`streakOf`),業務邏輯在 `src/server/habits.ts`。

### `habit`

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `id` | integer PK autoincrement | 否 | |
| `name` | text | 否 | trim 後不可空 |
| `periodType` | text | 否 | `daily` / `weekly` / `monthly`,CHECK |
| `target` | integer | 是 | 每週期目標次數,CHECK `NULL` 或 `>= 1`;`null` = 紀錄型(不判定達成、沒有 streak) |
| `sortOrder` | integer | 否 | 小的在前,新建放最後;不保證連號 |
| `createdAt` | integer (Unix 秒) | 否 | |

`periodType` 與 `target` 是「現在的設定」的快取,歷史在 `habit_settings_history`。

### 其他習慣表

- `habit_log`(完成一次 = 一列,不存週期累計數):`id`、`habitId`(FK,ON DELETE CASCADE)、`date`(text `YYYY-MM-DD`)、`createdAt`(Unix 秒)。
- `habit_settings_history`:`id`、`habitId`(FK,ON DELETE CASCADE)、`periodType`、`target`(可空)、`effectiveFrom`(text `YYYY-MM-DD`)。建立習慣時寫第一筆(`effectiveFrom` = 建立日);改週期或改目標都追加**完整**的一筆(`effectiveFrom` = 今天),`name` 不進歷史。同一天多筆時 id 大的較新。
- `habit_pause`:`id`、`habitId`(FK,ON DELETE CASCADE)、`startDate`、`endDate`(可空,兩端都含當天)。

### 領域規則

- **停止不建新實體。** `habit` 沒有 `endedAt`:停止中 = 存在 `endDate` 為 null 的 `habit_pause` 列;partial unique index 保證同一習慣最多一段。停止寫 `startDate` = 今天,恢復補 `endDate` = 今天;已停止時再停止(`state: already_paused`)、未停止時恢復(`state: not_paused`)都回 `VALIDATION_FAILED`。
- **刪除是硬刪除**(同 task),log、設定歷史、停止區間一起刪。要保留紀錄請用停止。
- `addLog`:日期格式不合 → `invalid_format`;晚於今天 → `invalid_value`;停止中 → `state: paused`;過去日期允許(補登)。`removeLog` 刪該日期 id 最大的一列,沒有 → `date: no_log`。
- 進度:`count` 是當前週期的 log 數,不封頂。週期起始:daily 當天、weekly 該週 `WEEK_START`(週一)、monthly 1 日。
- streak(單位跟著週期):從今天所屬週期往前;與任一停止區間有交集的週期跳過(不計入也不中斷);每個週期用它最後一天(不超過今天)生效的 `target` 判定;當前週期未達成不算斷;該期 `target` 為 null(當時是紀錄型)→ 停止。下限是目前週期類型那一段設定的第一筆 `effectiveFrom` 所屬週期:改週期後 streak 從變更起重算,只改目標不重算。
- 用到「今天」的函式都以參數接收 `today`;route 傳伺服器本地時區的 `todayIso()`。
