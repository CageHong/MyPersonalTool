# 資料模型

欄位表、時間處理規則,以及伺服器端的領域規則。**動到 schema、migration 或 `src/modules/tasks/server/` 的計算邏輯前讀這一份。**

事實來源是 `src/modules/tasks/db/schema.ts` 與 `src/modules/tasks/server/`;本檔與程式碼不一致時以程式碼為準,並在同一次修改裡更新本檔。

決策理由見 `docs/tasks/decisions.md` §2、§6a、§6b。

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
| `pinned` | integer(布林)預設 false | 否 | 置頂,全域語意:在任何清單都進最上方的置頂區塊。只收布林值 |
| `editedAt` | integer (Unix 秒) | 是 | `null` = 建立後未被編輯過;`0` = 欄位上線前既有的未完成重複實例,是否編輯過未知 |
| `excludeFromSummary` | integer(布林)預設 false | 否 | 不進三則每日摘要;不影響個別提醒 |

### 時間處理規則

- 絕對瞬間一律存 **Unix 秒數整數**(`createdAt`、`completedAt`、`scheduledAt`)。
- `dueDate` 是**日曆日**,存文字 `YYYY-MM-DD`,不要轉成時間戳(理由見 `docs/tasks/decisions.md` §2)。
- `dueDate`、`startDate` 必須是真實存在的日曆日(`isCalendarDate`,在 `src/modules/tasks/server/validation.ts`);`2026-02-30` 這種形狀合法但不存在的日期回 `invalid_format`。
- `dueTime` 與 `dueDate` 分開,因為「9/10 到期」和「9/10 15:00 到期」語意不同。
- `durationMinutes` 是長度不是時刻,存分鐘數。
- 完成狀態用 `completedAt` 判斷,**不要**加布林欄位(理由見 `docs/tasks/decisions.md` §2)。
- `createdAt` 在 schema 層**沒有**預設值,由 `src/modules/tasks/server/` 的建立函式填入 `Math.floor(Date.now() / 1000)`。理由:那是業務規則,不放資料層。

### 更新規則(`updateTask`)

- 完成狀態收 `done: boolean`,不收 `completedAt`(收到回 `VALIDATION_FAILED`,`fields.completedAt`)。冪等規則同 checklist 項目:未完成時收到 `done: true` → 寫入當下時間;已完成時收到 `done: true` → 保留原值;`done: false` → `null`,已經是 `null` 就不變。
- 其他欄位新值與現有值相同時視為沒有變化(`title` 比 trim 後的值,`priority` 的 `null` 視為 0)。
- 整個 patch 都沒有實際變化時不寫入資料庫。task 表沒有 `updatedAt`。
- 任何真的改變資料的寫入（`updateTask`、checklist 項目的新增／修改／刪除／排序）都會把 `task.editedAt` 設為當下 Unix 秒數；patch 沒改變任何欄位時不設。

### `priority` 的語意

- 值域固定為 0 / 1 / 3 / 5,對映 無 / 低 / 中 / 高。數字大 = 重要。
- 刻意留空隙(2、4 不用),之後插一級不需要改既有資料。
- 資料庫欄位是 NOT NULL DEFAULT 0。應用層接受 null,但在 `src/modules/tasks/server/` 正規化成 0 再寫入;`createTask` 未傳時同樣填 0。

### 批次建立(`createTasks`)

- 收 `CreateTaskInput[]`,1 到 100 筆(`BATCH_MAX`,與 `src/modules/tasks/lib/bulk.ts` 的 `BULK_MAX_LINES` 同值);空陣列或不是陣列 → `tasks: required`,超過 → `tasks: too_many`。
- 驗證在寫入前全部做完,錯誤的 key 是「索引.欄位」(例:`1.title: required`)。
- 整批在一個 transaction 裡寫入,共用同一個 `createdAt`;順序靠 id 遞增保住。

## `task_list_view`

清單的呈現設定(分組與排序),每個清單一列。它描述「現在想怎麼看這個清單」,不是任務的屬性(理由見 `docs/tasks/decisions.md` §6d)。

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `listKey` | text PK | 否 | 清單的識別字;目前只有智慧檢視的 id:`today` / `next7` / `open` / `done` |
| `groupBy` | text | 否 | `none` / `date` / `priority`,CHECK |
| `sortBy` | text | 否 | `created` / `dueDate` / `priority` / `title`,CHECK |
| `sortDirection` | text | 否 | `asc` / `desc`,CHECK |
| `updatedAt` | integer (Unix 秒) | 否 | |

- 沒有對應的列 = 用預設值。預設值在 `src/modules/tasks/lib/listView.ts` 的 `defaultSettings`,**不落地**:今天與未來 7 天預設依日期分組,其餘不分組;排序一律預設建立時間升冪。
- `saveViewSettings(listKey, settings)` 是整份替換(upsert),三個欄位都要給;`listKey` 不是上面四個之一 → `listKey: invalid_value`。
- 值域(`GROUP_BY_VALUES` 等)定義在 `src/modules/tasks/lib/listView.ts`,伺服器與前端共用同一份。

### 分組、排序、置頂的計算(`arrangeTasks`)

純函式,在 `src/modules/tasks/lib/listView.ts`,前端在篩選(`filterTasks`)之後呼叫;「今天」以參數傳入。

- 先排序、再抽出置頂、再分組。回傳由上到下的區塊(`Section[]`),攤平就是畫面上的列順序。
- 排序的決勝鍵固定是 `createdAt` 再 `id`。空值沉底:依截止日排序時沒有日期的、依優先級排序時無優先級的,不論方向都排最後。標題用 `Intl.Collator('zh-Hant', { numeric: true })`。
- 依日期分組的桶:逾期 / 今天 / 明天 / 本週 / 更晚 / 無日期,相對今天計算(本週的最後一天依 `WEEK_START`);「明天」優先於「本週」。依優先級:高 / 中 / 低 / 無優先級。桶的順序固定,不跟排序方向走;空的桶不出現。
- 置頂區塊只收未完成的置頂任務,它們從原本的分組抽離;各分組的筆數因此不含置頂的。區塊內沿用同一個排序。
- 不分組且有置頂區塊時,剩下的那一區標題是「其他」;不分組也沒有置頂時只有一區、沒有標題。

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

完成狀態的冪等規則(函式收 `done: boolean`,只在 `src/modules/tasks/server/` 轉換):

- 未勾時收到 `done: true` → 寫入當下時間;已勾時收到 `done: true` → 保留原值。
- `done: false` → `null`;已經是 `null` 就不變。
- 狀態沒有實際變化時,不更新 `updatedAt`。

`createChecklistItems(taskId, titles)`:批次新增,1 到 100 筆,整批放在最後、照陣列順序,一個 transaction;任一標題空白整批拒絕(`索引.title: required`)。

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
| `excludeFromSummary` | integer(布林)預設 false | 否 | 範本內容,會帶到新產生的實例;修改時從明天起未完成的實例重新產生 |
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

函式在 `src/modules/tasks/server/recurrence.ts`,日期展開 `expandRule` 在 `src/modules/tasks/lib/recurrence.ts`。

- 用到「今天」的函式都以參數接收 `today`,不在函式內讀時鐘;`listTasks()` 查詢前以伺服器本地時區的今天呼叫 `fillInstances`。
- 補齊終點 = 今天 + 6(含),對上「未來 7 天」檢視。
- 錯過就跳過:進行中的規則在 `fillRule` 補齊前,先刪除未完成、`occurrenceDate` 與 `dueDate` 都早於今天、且 `editedAt` 為 `null` 的實例(checklist 一起刪除),再從不早於今天的日期開始補齊(水位線已超過終點時仍會先刪除)。`editedAt = 0`(上線前既有實例)與已編輯過的實例會保留為逾期;既有實例的清理另由 `npm run tasks:skip-legacy-missed` 處理(推斷為沒編輯過的:已錯過的刪除,還沒錯過的 `editedAt` 改回 `null`;推斷為編輯過的維持 `0`)。
- 建立規則時不回溯:原任務是第一個實例(`editedAt` 設為轉換時間,視為編輯過),水位線設為 max(第一個日期, 昨天),規則建立前的日期不產生實例。原任務既有的提醒:相對提醒且 `daysBefore <= 6` 的搬到規則上成為範本(`task_id = null, rule_id = rule.id`),絕對提醒與 `daysBefore > 6` 的相對提醒留在原任務上。
- 停止重複可逆:任務的規則已停止時 `createRuleFromTask` 允許建新規則,任務改指向新規則;舊規則與它的其他實例不動。規則仍在進行中才回 `already_set`。
- 改規則(`updateRule`)與停止(`stopRule`)先用舊規則補到最新,再刪除今天之後、未完成的實例。

## 習慣

習慣是配額(每週期做幾次),和重複任務(日曆規則)是兩個獨立實體,不共用表(理由見 `docs/tasks/decisions.md` §6b)。純函式在 `src/modules/tasks/lib/habit.ts`(`periodStart`、`settingsAt`、`progressOf`、`streakOf`),業務邏輯在 `src/modules/tasks/server/habits.ts`。

### `habit`

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `id` | integer PK autoincrement | 否 | |
| `name` | text | 否 | trim 後不可空 |
| `periodType` | text | 否 | `daily` / `weekly` / `monthly`,CHECK |
| `target` | integer | 是 | 每週期目標次數,CHECK `NULL` 或 `>= 1`;`null` = 紀錄型(不判定達成、沒有 streak) |
| `sortOrder` | integer | 否 | 小的在前,新建放最後;不保證連號 |
| `excludeFromSummary` | integer(布林)預設 false | 否 | 不進三則每日摘要;不影響個別提醒 |
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

## 通知

- `task_notification_setting`:三則每日摘要的設定。`kind` PK(`morning` / `afternoon` / `evening`,CHECK)、`time`(`HH:MM`)、`enabled`(boolean)、`updatedAt`(Unix 秒)。沒有列時由程式回傳預設值(`08:00` / `15:00` / `21:00`,皆啟用),預設不落地;儲存時驗證三則時刻嚴格遞增 `morning < afternoon < evening`(含停用的摘要)。
- `task_notification_sent`:每日已送出的通知標記。`id`、`key`(例如 `summary:morning`、`reminder:<提醒id>:<HH:MM>`、`reminder:<提醒id>:<任務id>:<HH:MM>`)、`date`(`YYYY-MM-DD`)、`sentAt`(Unix 秒);唯一鍵 `(key, date)` 確保同一天同一則只送一次。沒有內容的摘要、已達標的習慣提醒、已完成的任務提醒會在計算到期時直接寫入標記而不送出。
- `task_reminder`:個別提醒(每個項目上限 5 則)。`id`、三個可空外鍵 `taskId` / `ruleId` / `habitId`(皆 `ON DELETE CASCADE`,CHECK 恰好一個非空)、`kind`(`daily` / `relative` / `absolute`,CHECK)、`time`(`HH:MM`)、`daysBefore`(相對提醒專用:任務 0–28、規則 0–6)、`date`(絕對提醒專用:`YYYY-MM-DD`,存檔時不可早於現在)、`createdAt`、`updatedAt`。習慣只收 `daily`、規則只收 `relative`、任務收 `relative` 或 `absolute`。
