# notify-reminders:提醒表、不進摘要、高優先、任務提醒(後端)

> 先擬計畫:讀完程式碼後在「實作計畫」寫出要改的檔案與步驟,commit 後停下,等主線確認才實作。

## 0. 準備
分支 `gemini/notify-reminders` 由主線從 main 建好,上面有主線寫的測試與這張卡。直接在這個分支上工作。worktree 與假資料規則照 `AGENTS.md`。

## 目標
實作 `docs/tasks/decisions.md` §6j「提醒」表末標「(2026-11-22 改)」的條目的後端,視圖與摘要設定的存法那兩條除外(前端,卡 4):提醒改成獨立的表(習慣每天的時刻;任務的相對／絕對提醒;重複規則的相對提醒)、任務／重複規則／習慣的「不進摘要」、早上總覽的「高優先」組,以及提醒的 API。

通知是卡 2(`done/notify-tasks.md`)做的;這張改它的資料結構。提醒視圖(`view=reminders`)、右欄的提醒編輯器、錯誤代碼的中文(`lib/errors.ts`)是卡 4,不在這張。

## 背景
`docs/tasks/decisions.md` §6j「提醒」(規則以它為準,畫了刪除線的是被取代的舊規則)、§6a 與 §8(重複任務的實例與水位線)、`docs/platform/decisions.md` §8(runner)、`src/modules/tasks/server/notifications.ts`、`docs/tasks/data-model.md`。

要點(規則以 decisions 為準,介面以測試為準):
- 新檔 `src/modules/tasks/server/reminders.ts`:`createReminder(owner, input, now: Date)`、`updateReminder(id, input, now)`(整份替換,owner 不變)、`deleteReminder(id)`、`listReminders(owner)`(id 升冪),型別 `Reminder`。`owner` 是 `{ taskId } | { ruleId } | { habitId }`;`input` 是 `{ kind: 'daily', time }`(習慣)、`{ kind: 'relative', daysBefore, time }`(任務、規則)、`{ kind: 'absolute', date, time }`(任務)。驗證的 `fields` 代碼見 `reminders.test.ts`(`kind`、`time`、`daysBefore`、`date: invalid_format | in_past`、`reminders: too_many`)。`daysBefore` 上限:任務 28、規則 6(實例只落地到今天 + 6)。
- schema:新表 `taskReminder`(`task_reminder`)。owner 用三個可空外鍵 `task_id` / `rule_id` / `habit_id`,CHECK 恰好一個非空,外鍵 `ON DELETE CASCADE`;不用「種類 + id」的多型欄位,因為那樣沒有外鍵,刪掉項目時提醒會留下。`task`、`task_recurrence_rule`、`habit` 各加 `exclude_from_summary`(boolean,預設 false)。
- **`habit.reminder_time` 搬進新表後拿掉。** 產生出來的 migration 不能手改;資料搬移請用 `drizzle-kit generate --custom` 產生一個空的 migration 自己寫 SQL(這是唯一可以手寫 SQL 的地方)。順序大概是:建表與加欄位(產生)→ 把有值的 `reminder_time` 寫成 `kind = 'daily'` 的提醒(custom)→ 拿掉欄位(產生)。實際怎麼切請在計畫裡寫。`migrations.test.ts` 的種子要有一個設了 `reminder_time` 的習慣,並驗證搬過去了。
- 已送標記的 key(runner 的 key 是 `<key>@<YYYY-MM-DD>`):習慣 `reminder:<提醒id>:<HH:MM>`;任務與規則 `reminder:<提醒id>:<任務id>:<HH:MM>`。帶時刻,是為了送出後把時刻改晚,當天會再送;帶任務 id,是因為同一條規則的兩個實例可能被改成同一天到期。舊的 `habit:<id>` 標記留在表裡無害,不用清。
- 相對提醒的送出日 = 任務的 `dueDate` − `daysBefore`;重複規則的提醒對每個未完成的實例,用**實例自己的** `dueDate` 算。只看送出日 = 今天的,當天之內補送(同習慣)。任務已完成:不送、照樣記為已送(同「習慣已達標」)。
- 任務提醒的訊息:標題 `任務提醒`,內文是任務標題加到期說明 `(今天到期)` / `(明天到期)` / `(N 天後到期)` / `(逾期)`,沒有到期日就只有標題。回傳順序:摘要在前,個別提醒依時刻、再依提醒 id。
- 「高優先」組:早上總覽,放在「任務」與「習慣」之間;`priority = 5`、未完成、不在今天到期與逾期之內;重複任務只列最早未完成的實例(`lib/views.ts` 的 `collapseRecurring`);順序同 `listTasks`。
- 「不進摘要」:三則摘要都排除;不影響個別提醒。規則上的值:`createRuleFromTask` 從原任務帶過去、實例產生時帶上;`updateRule` 改它時照 title / priority 的既有做法(範本改了,明天起的未完成實例重新產生)。`createTask` / `updateTask` / `createHabit` / `updateHabit` / `updateRule` 都收這個欄位,非 boolean 回 `invalid_value`。
- API:
  - `GET /api/tasks/reminders?taskId=|ruleId=|habitId=`(三選一)
  - `POST /api/tasks/reminders`,body 是 owner 的那個 id 欄位加 `input`
  - `PUT /api/tasks/reminders/[reminderId]`(整份替換)、`DELETE /api/tasks/reminders/[reminderId]`
  - route 的 `now` 用 `new Date()`。任務、習慣、規則既有的 POST / PATCH 收 `excludeFromSummary`;習慣不再收 `reminderTime`。

## 可以改的檔案
- 新增 `src/modules/tasks/server/reminders.ts`、`src/app/api/tasks/reminders/route.ts`、`src/app/api/tasks/reminders/[reminderId]/route.ts`
- `src/modules/tasks/db/schema.ts`、`npm run tasks:db:generate` 產生的 migration、上述那一個 custom migration、`src/modules/tasks/db/migrations.test.ts`(種子照倒數第二版)
- `src/modules/tasks/server/notifications.ts`、`habits.ts`、`tasks.ts`、`recurrence.ts`、`validation.ts`、`errors.ts`(只在需要新錯誤類別時)
- `src/modules/tasks/lib/views.ts`(只在需要匯出既有函式時)
- `src/app/api/tasks/` 底下既有的 tasks、habits、recurrence-rules route(只在型別或欄位需要時)
- **前端只能做到 `tsc` 會過**:`habit.reminderTime` 拿掉後,`src/modules/tasks/components/` 用到它的地方會壞,只做最小的移除(例如右欄那個輸入框先拿掉),不要做新的 UI
- `docs/tasks/data-model.md`、`docs/tasks/api.md`、`docs/tasks/backlog.md`(通知那條:卡 3 後端完成、卡 4 UI 待做)
- 要的話可以加自己的測試檔

## 不能改的檔案
`src/platform/`、`src/jobs/`、`src/app/tasks/`、`AGENTS.md`、`CLAUDE.md`、`docs/*/decisions.md`。主線的測試不能改。

## 測試(主線提供)
- `src/modules/tasks/server/reminders.test.ts`:提醒的新增／修改／刪除與驗證、上限 5 則、cascade、`excludeFromSummary` 的欄位與規則的傳遞
- `src/modules/tasks/server/notifications.test.ts`:前半是卡 2 的摘要測試(沒改);標「以下規格」之後是新的:不進摘要、高優先組、習慣／任務／規則提醒的送出與補送、已送標記、回傳順序

測試就是規格。覺得測試有錯就停下,寫進回報。

## 完成條件
- `npx next typegen` 後 `npx tsc --noEmit`、`npm run lint`、`npm test` 全過
- 在沙盒資料夾:先在舊版 schema 建一個設了 `reminderTime` 的習慣,`npm run tasks:db:migrate` 後確認它變成一則 `daily` 提醒;再跑 `npm run notify:tick`,貼上輸出
- 用 `curl` 打一次提醒的 POST(含一次 `in_past` 與一次 `too_many`)、PUT、DELETE,結果寫進回報
- commit 前綴 `tasks:`

## 合併後(主線做,寫在這裡備忘)
- 合併進 main 後**馬上** `npm run deploy`(理由同卡 2:runner 讀原始碼,新表要等 deploy 套用 migration)。
- deploy 前先備份正式的 `tasks.db`:這張的 migration 會拿掉欄位。

## 疑問(主線已知,計畫裡請回應)
- 任務變成重複規則(`createRuleFromTask`)時,原任務已經有的提醒怎麼辦?主線傾向:相對提醒搬到規則上(成為範本),絕對提醒留在原任務。測試沒有涵蓋,請在計畫裡寫你的做法。
- 重複規則的提醒對「每個未完成實例」算送出日:實例最多到今天 + 6,`daysBefore` 上限 6 剛好碰得到。請確認 `dueTaskNotifications` 呼叫 `listTasks({ today })` 時實例已經補齊。

## 實作計畫(標「先擬計畫」時,Gemini 先填,等主線確認)

### 預計修改與新增的檔案
- **Schema 與 Migration**:
  - `src/modules/tasks/db/schema.ts`
  - `src/modules/tasks/drizzle/0009_*.sql`（`npm run tasks:db:generate` 產生：建 `task_reminder`、三個表加 `exclude_from_summary`）
  - `src/modules/tasks/drizzle/0010_*.sql`（`npx drizzle-kit generate --config src/modules/tasks/drizzle.config.ts --custom` 產生：把 `habit.reminder_time` 搬進 `task_reminder`）
  - `src/modules/tasks/drizzle/0011_*.sql`（`npm run tasks:db:generate` 產生：拿掉 `habit.reminder_time`）
  - `src/modules/tasks/db/migrations.test.ts`
- **後端業務邏輯 (`src/modules/tasks/server/`)**:
  - 新增 `reminders.ts`
  - 修改 `tasks.ts`、`habits.ts`、`recurrence.ts`、`notifications.ts`
- **API Route (`src/app/api/tasks/`)**:
  - 新增 `reminders/route.ts`、`reminders/[reminderId]/route.ts`
- **文件 (`docs/tasks/`)**:
  - `data-model.md`、`api.md`、`backlog.md`
- （經 `grep` 確認 `src/modules/tasks/components/` 目前沒有引用 `reminderTime`，實作時會再以 `npx tsc --noEmit` 確認。）

### 實作步驟
1. **Schema 與三階段 Migration**:
   - **Step 1**：在 `schema.ts` 新增 `taskReminder`（`task_reminder`），含 `id`、三個可空外鍵 `taskId` / `ruleId` / `habitId`（皆 `ON DELETE CASCADE`）、CHECK 約束（恰好一個外鍵非空、`kind IN ('daily', 'relative', 'absolute')`）、`kind`、`time`、`daysBefore`、`date`、`createdAt`、`updatedAt`，並對三個外鍵建 index。在 `task`、`taskRecurrenceRule`、`habit` 各加 `excludeFromSummary`（`integer('exclude_from_summary', { mode: 'boolean' }).notNull().default(false)`），此時暫時保留 `habit.reminderTime`。執行 `npm run tasks:db:generate` 產生 `0009`。
   - **Step 2**：執行 `npx drizzle-kit generate --config src/modules/tasks/drizzle.config.ts --custom` 產生空的 `0010`，寫入 SQL 將 `habit.reminder_time IS NOT NULL` 的列搬入 `task_reminder`（`habit_id = id`, `kind = 'daily'`, `time = reminder_time`, `created_at = CAST(strftime('%s', 'now') AS integer)`, `updated_at = CAST(strftime('%s', 'now') AS integer)`）。
   - **Step 3**：從 `schema.ts` 的 `habit` 移除 `reminderTime`，執行 `npm run tasks:db:generate` 產生 `0011`。
   - **Migration 測試**：更新 `migrations.test.ts` 的 `SEED`（配合 `0010` schema，補上一筆 `task_reminder` 使全表有資料）；另加一個測試從 `0008` 起跑，塞入設了 `reminder_time = '09:00'` 與 `NULL` 的習慣，套用 `0009`–`0011` 後驗證 `'09:00'` 已搬進 `task_reminder` 且 `habit` 不再有 `reminder_time` 欄位。
2. **提醒 CRUD 與驗證 (`src/modules/tasks/server/reminders.ts`)**:
   - 定義 `Reminder`、`ReminderOwner`（`{ taskId } | { ruleId } | { habitId }`）、`ReminderInput`（`daily` / `relative` / `absolute`），單一 owner 上限 5 則。
   - `listReminders(owner)`：確認 owner 存在（不存在丟 `NotFoundError`），依 `id` 升冪回傳。
   - `createReminder(owner, input, now)`：確認 owner 存在；驗證 `kind` 與 owner 相容性（habit → `daily`、task → `relative | absolute`、rule → `relative`）、`time`（`isTimeOfDay`）、`daysBefore`（整數，task `0..28`、rule `0..6`）、`date`（`isCalendarDate` 回 `invalid_format`；小於今天或等於今天且 `time < currentTime` 回 `in_past`）、筆數上限（`>= 5` 回 `reminders: 'too_many'`）。
   - `updateReminder(id, input, now)`：查無該筆丟 `NotFoundError`，沿用原 owner 做整份替換與相同驗證（切換 `relative` / `absolute` 時把不屬於該 `kind` 的欄位清為 `null`）。
   - `deleteReminder(id)`：刪除並於不存在時丟 `NotFoundError`。
3. **移除 `habit.reminderTime` 與加入 `excludeFromSummary`**:
   - `habits.ts`：移除 `reminderTime` 欄位與驗證；`createHabit` / `updateHabit` 支援 `excludeFromSummary`（預設 `false`，非 boolean 回 `excludeFromSummary: 'invalid_value'`）。
   - `tasks.ts`：`createTask` / `createTasks` / `updateTask` 支援 `excludeFromSummary`（預設 `false`，非 boolean 回 `excludeFromSummary: 'invalid_value'`）。
   - `recurrence.ts`：`createRuleFromTask` 從原任務帶入 `excludeFromSummary`；`fillRule` 產生實例時帶入 `rule.excludeFromSummary`；`updateRule` 支援 `excludeFromSummary`（同 `title` / `priority` 納入 `merged`，變更時明天起實例重產）。
   - `createRuleFromTask` 對原任務既有提醒的處理（見疑問 1 回應）：將 `kind = 'relative'` 且 `daysBefore <= 6` 的提醒改掛到新規則（`task_id = null, rule_id = rule.id`）；`absolute` 提醒留在原任務上。
4. **通知計算 (`src/modules/tasks/server/notifications.ts`)**:
   - 摘要：`todayTasks` 與 `habits` 過濾 `!excludeFromSummary`；早上總覽在「任務」與「習慣」之間新增「高優先」組（`collapseRecurring(allTasks, today).tasks` 中 `completedAt === null && priority === 5 && !excludeFromSummary && (dueDate === null || dueDate > today)`，維持 `listTasks` 順序，格式 `- ${title}`）。
   - 個別提醒：依 `time` 升冪、再依 `reminder.id` 升冪評估與回傳（排在摘要之後）：
     - 習慣（`habitId`）：進行中、`currentTime >= r.time`、未 sent（key `reminder:${r.id}:${r.time}`）。已達標則寫入 `autoMarkKeys` 不送；未達標或無目標則送 `習慣提醒`。
     - 任務（`taskId`）：`absolute` 看 `r.date === today`，`relative` 看 `t.dueDate !== null && addDays(t.dueDate, -r.daysBefore!) === today`。到時刻、未 sent（key `reminder:${r.id}:${t.id}:${r.time}`）時，若已完成則寫入 `autoMarkKeys` 不送；否則送 `任務提醒`，內文依 `diffDays(today, t.dueDate)` 附加 `(今天到期)` / `(明天到期)` / `(N 天後到期)` / `(逾期)`，無到期日僅列標題。
     - 重複規則（`ruleId`）：對 `allTasks` 中所有 `recurrenceRuleId === r.ruleId` 的實例，依實例自己的 `dueDate` 計算送出日，其餘判斷、key（帶實例 `t.id`）與訊息格式同任務提醒。
5. **API Routes**:
   - `src/app/api/tasks/reminders/route.ts`：`GET` 解析 `taskId` / `ruleId` / `habitId`（必須恰好一個且為正整數，否則回 `400 VALIDATION_FAILED`）呼叫 `listReminders`；`POST` 讀 JSON object，拆出單一 owner id 與剩餘欄位作為 `input`，呼叫 `createReminder(..., new Date())`，回 201。
   - `src/app/api/tasks/reminders/[reminderId]/route.ts`：因為 `src/app/api/_lib/http.ts` 不在可改檔案清單內，於本檔內直接驗證 `reminderId` 為 `/^\d+$/`（不合法回 `400 VALIDATION_FAILED`，`fields: { reminderId: 'invalid' }`），實作 `PUT`（`updateReminder(..., new Date())`）與 `DELETE`（`deleteReminder` 回 204）。
6. **文件與驗證**:
   - 更新 `docs/tasks/data-model.md`、`docs/tasks/api.md`、`docs/tasks/backlog.md`。
   - 依完成條件跑 `npx next typegen`、`npx tsc --noEmit`、`npm run lint`、`npm test`，並在沙盒資料庫實測 migration、`notify:tick` 與 `curl` CRUD。

### 疑問回應
1. **任務變成重複規則(`createRuleFromTask`)時,原任務既有的提醒**：
   - 同意主線方向：在 `createRuleFromTask` 的 transaction 內，將原任務上 `kind = 'relative'`（且 `daysBefore <= 6`）的提醒改掛到新規則（`UPDATE task_reminder SET task_id = NULL, rule_id = rule.id`），讓它成為規則範本並套用到所有實例（原任務本身已變成第一個實例，因此不會漏掉也不會重複送）；`kind = 'absolute'` 留在原任務上。若原任務碰巧有 `daysBefore > 6` 的相對提醒（規則上限為 6），因無法直接轉為規則提醒，擬留在原任務上（僅對第一個實例生效）以避免靜默截斷或拒絕轉換。
2. **重複規則實例補齊與 `dueTaskNotifications`**：
   - 已確認 `src/modules/tasks/server/tasks.ts` 的 `listTasks({ today })` 會在查詢前呼叫 `fillInstances(today)`，而 `src/modules/tasks/server/recurrence.ts` 的 `FILL_AHEAD_DAYS = 6`（補齊終點 `today + 6` 含當天）。規則的 `daysBefore` 上限為 6，因此任何在今天觸發提醒的實例（`dueDate` 介於 `today` 到 `today + 6`）在 `listTasks({ today })` 回傳時都已落地。

## 回報(Gemini 填寫)
- 做了什麼(每個檔案一行):
- 沒做什麼、為什麼:
- 每個完成條件怎麼驗證的:
- 最可能出錯的地方:
- 疑問:
