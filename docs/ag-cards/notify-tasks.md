# notify-tasks:tasks 的摘要與習慣提醒(後端)

> 先擬計畫:讀完程式碼後在「實作計畫」寫出要改的檔案與步驟,commit 後停下,等主線確認才實作。

## 0. 準備
分支 `gemini/notify-tasks` 由主線從 main 建好,上面有主線寫的測試與這張卡。直接在這個分支上工作。worktree 與假資料規則照 `AGENTS.md`。

## 目標
實作 `docs/tasks/decisions.md` §6j「提醒(2026-11-22 定案)」那張表的後端:兩張表、`habit.reminderTime`、三則摘要與個別習慣提醒的到期與內容計算,接上 runner 的對照表 `NOTIFIERS`;另加通知設定的 API。

這是三張卡的第二張。通知設定對話框與右欄的提醒時刻(卡 3)不在這張。

## 背景
`docs/tasks/decisions.md` §6j「提醒」(規則以它為準)、`docs/platform/decisions.md` §8(runner)、`src/jobs/notifiers.ts`、`src/jobs/notify.ts`(runner 怎麼呼叫 `dueNotifications` / `markSent`)、`docs/tasks/data-model.md`。

要點(規則本身以 decisions 為準,介面以測試為準):
- 新檔 `src/modules/tasks/server/notifications.ts`,匯出 `getNotificationSettings`、`saveNotificationSettings`、`dueTaskNotifications(now: Date)`、`markTaskNotificationsSent(keys: string[])`、型別 `NotificationSettings`。
- schema:`taskNotificationSetting`(`task_notification_setting`,每則摘要一列;沒有列 = 預設值,預設不落地,同 `task_list_view`)、`taskNotificationSent`(`task_notification_sent`,欄位至少 `key`、`date`、送出時刻;唯一鍵 `(key, date)`)、`habit.reminderTime`(`reminder_time`,可空)。HH:MM 的驗證可共用 `server/tasks.ts` 的 `DUE_TIME_PATTERN`(搬到 `server/validation.ts`)。
- runner 的 `key` 是 `<§6j 的 key>@<YYYY-MM-DD>`,例如 `summary:morning@2026-09-19`、`habit:12@2026-09-19`;`markTaskNotificationsSent` 拆開後寫進 `(key, date)`,已存在的略過。
- 「今天」與「現在幾點」都從 `now` 的**本地**日期與時刻算(用 `lib/date.ts` 的慣例,不用 `toISOString`)。
- 「沒有內容不送、照樣記為已送」與「個別提醒已達標不送、照樣記為已送」:runner 只會對**送出成功**的 key 呼叫 `markSent`,所以這兩種要在 `dueTaskNotifications` 裡自己寫入已送標記,不回傳給 runner。
- 習慣進度與「今天到期與逾期」分別用 `listHabits(today)` 與 `filterTasks(listTasks({ today }), 'today', today)`,不另寫一套。晚上收尾要知道週期的最後一天:可以把 `lib/habit.ts` 的 `periodEnd` 匯出。
- 訊息格式(標題、分組、`(逾期)`、`冥想 4/6`)與回傳順序見測試。
- `src/jobs/notifiers.ts` 的 `NOTIFIERS` 加 `tasks`。**用動態 `import()` 在函式裡載入 tasks 模組**,不要在檔案頂端靜態匯入:`src/jobs/notify.test.ts` 會載入 `notifiers.ts`,靜態匯入會讓測試在 import 時就打開真正的 tasks 資料庫。
- 通知設定 API:`GET` / `PUT /api/tasks/notification-settings`(PUT 是整份替換,body 同 `NotificationSettings`);習慣的 POST / PATCH 收 `reminderTime`(route 已經把 body 直接交給 server,確認型別有跟上即可)。

## 可以改的檔案
- 新增 `src/modules/tasks/server/notifications.ts`、`src/app/api/tasks/notification-settings/route.ts`
- `src/modules/tasks/db/schema.ts`、用 `npm run tasks:db:generate` 產生的 migration、`src/modules/tasks/db/migrations.test.ts`(種子照倒數第二版)
- `src/modules/tasks/server/habits.ts`、`server/validation.ts`、`server/tasks.ts`(只搬 `DUE_TIME_PATTERN`)、`lib/habit.ts`(只匯出 `periodEnd`)
- `src/app/api/tasks/habits/route.ts`、`src/app/api/tasks/habits/[habitId]/route.ts`(只在型別需要時)
- `src/jobs/notifiers.ts`(只加 `tasks`)
- `src/jobs/notify-cli.ts`:log 的時間戳改成本地時間(現在是 `toISOString()` 的 UTC,讀 log 時容易差一小時以上);格式例如 `2026-09-19 08:00:03`
- `docs/tasks/data-model.md`、`docs/tasks/api.md`、`docs/tasks/backlog.md`(通知那條:卡 2 完成,卡 3 待做)
- 要的話可以加自己的測試檔

## 不能改的檔案
`src/platform/`、`src/jobs/notify.ts`、`src/modules/tasks/components/`、`src/app/tasks/`、`AGENTS.md`、`CLAUDE.md`、`docs/*/decisions.md`。主線的測試不能改。

## 測試(主線提供)
- `src/modules/tasks/server/notifications.test.ts`:通知設定的預設值與驗證、`habit.reminderTime`、三則摘要的到期／補送窗口／內容、個別習慣提醒、已送標記、回傳順序

測試就是規格。覺得測試有錯就停下,寫進回報。

## 完成條件
- `npx next typegen` 後 `npx tsc --noEmit`、`npm run lint`、`npm test` 全過
- 在沙盒資料夾:`npm run tasks:db:migrate` 後跑 `npm run notify:tick`,貼上輸出(沙盒沒有 Telegram 設定時送出會失敗,這是預期的;要看到的是 tasks 的 key 有被算出來)
- 用 `curl` 打一次 `GET` / `PUT /api/tasks/notification-settings`(含一次順序不合的 PUT),結果寫進回報
- commit 前綴 `tasks:`(`notify-cli.ts` 那一個用 `platform:`)

## 合併後(主線做,寫在這裡備忘)
- 合併進 main 後**馬上** `npm run deploy`。runner 讀 repo 的原始碼,合併當下就跑新程式;但新表要等 deploy 套用 migration 才存在,中間每 15 分鐘的 tick 都會在 tasks 的 `due` 階段失敗。

## 疑問(主線已知,計畫裡請回應)
- `dueTaskNotifications` 每次都呼叫 `listTasks`,而 `listTasks` 會補齊重複任務的實例(寫入)。runner 每 15 分鐘跑一次,等於每 15 分鐘補一次;請確認這在 runner 與網頁同時開著時沒問題(DB 已是 WAL),或提出別的做法。

## 實作計畫(標「先擬計畫」時,Gemini 先填,等主線確認)

### 要新增／修改的檔案
1. **修改 `src/modules/tasks/db/schema.ts` 與產生 migration**
   - 新增 `taskNotificationSetting`（`task_notification_setting`）：`key`（`text`, PK, `CHECK IN ('morning', 'afternoon', 'evening')`）、`time`（`text`, not null）、`enabled`（`integer` boolean, not null）、`updatedAt`（`integer`, not null）。
   - 新增 `taskNotificationSent`（`task_notification_sent`）：`id`（PK autoIncrement）、`key`（`text`, not null）、`date`（`text`, not null）、`sentAt`（`integer`, not null），加上 `uniqueIndex('task_notification_sent_key_date_uq').on(table.key, table.date)`。
   - `habit` 新增可空欄位 `reminderTime: text('reminder_time')`。
   - 執行 `npm run tasks:db:generate` 產生 migration（不手改產生的檔案與 `_journal.json`）；檢查 `src/modules/tasks/db/migrations.test.ts`（新表不在倒數第二版 schema、`habit.reminder_time` 可空，先跑測試確認，若需要再調整）。
2. **修改 `src/modules/tasks/server/validation.ts`、`tasks.ts`、`lib/habit.ts`**
   - 將 `DUE_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/` 搬到 `server/validation.ts` 並匯出 `isTimeOfDay(value: unknown): value is string`；`server/tasks.ts` 改從 `./validation` 匯入。
   - `src/modules/tasks/lib/habit.ts` 匯出 `periodEnd`。
3. **修改 `src/modules/tasks/server/habits.ts`**
   - `CreateHabitInput` 與 `UpdateHabitPatch` 加上 `reminderTime?: string | null`。
   - `collectErrors` 驗證 `reminderTime`（非 null/undefined 時須符合 `isTimeOfDay`，否則 `fields.reminderTime = 'invalid_value'`）。
   - `createHabit` 寫入 `reminderTime: input.reminderTime ?? null`；`updateHabit` 支援更新／清除 `reminderTime`（不寫入 `habitSettingsHistory`）。
4. **新增 `src/modules/tasks/server/notifications.ts`**
   - 匯出型別 `NotificationSettings`（`morning` / `afternoon` / `evening`，各含 `{ time: string; enabled: boolean }`）。
   - `getNotificationSettings()`：查詢 `task_notification_setting`，沒有列時回傳預設值（`08:00` / `15:00` / `21:00`，皆 `enabled: true`）。
   - `saveNotificationSettings(input)`：驗證三則皆為合法物件、`HH:MM` 與布林值（錯時 `fields[key] = 'invalid_value'`），且嚴格滿足 `morning.time < afternoon.time < evening.time`（含停用的摘要，不合時 `fields.times = 'out_of_order'`）；通過後在 transaction 內以 `onConflictDoUpdate` 寫入三列並回傳最新設定。
   - `markTaskNotificationsSent(keys)`：將 `<key>@<YYYY-MM-DD>` 拆成 `(key, date)`，以 `onConflictDoNothing` 寫入 `task_notification_sent`。
   - `dueTaskNotifications(now)`：
     - 從 `now` 的本地年月日時分算出 `today`（`YYYY-MM-DD`）與 `currentTime`（`HH:MM`），不用 `toISOString`。
     - 讀取設定與當天已送清單；以 `filterTasks(listTasks({ today }), 'today', today).tasks` 取今天到期與逾期未完成任務，以 `listHabits(today)` 取習慣進度。
     - 依 `morning` → `afternoon` → `evening` 順序檢查：已啟用、未送過、`currentTime >= setting.time`，且早於下一則**已啟用**摘要的 `time`（若後面沒有已啟用的則補到當天結束）。
     - 依 §6j 與測試格式組合純文字內容（略過空分組）；若完全沒內容，直接寫入 `task_notification_sent`（`onConflictDoNothing`）而不回傳給 runner。
     - 再依 `listHabits(today)` 順序檢查未停止且有設 `reminderTime` 的習慣：未送過且 `currentTime >= h.reminderTime`；若已有目標且已達標，直接寫入 `task_notification_sent` 不回傳；否則回傳 `{ key: 'habit:<id>@<today>', message: { title: '習慣提醒', body } }`（無目標只列名稱，有目標列 `名稱 count/target`）。
5. **新增 `src/app/api/tasks/notification-settings/route.ts`**
   - `GET` 回傳 `getNotificationSettings()`；`PUT` 以 `readJsonObject` 讀取 body 並呼叫 `saveNotificationSettings`，錯誤交給 `handleError`。
6. **修改 `src/jobs/notifiers.ts` 與 `src/jobs/notify-cli.ts`**
   - `src/jobs/notifiers.ts`：`NOTIFIERS` 加入 `tasks`，於 `dueNotifications` 與 `markSent` 內動態 `await import('../modules/tasks/server/notifications')`。
   - `src/jobs/notify-cli.ts`：log 時間戳改為本地時間 `YYYY-MM-DD HH:MM:SS`。
7. **修改文件**
   - 更新 `docs/tasks/data-model.md`、`docs/tasks/api.md`、`docs/tasks/backlog.md`（通知卡 2 完成、卡 3 待做）。

### 回應「疑問」
- **`dueTaskNotifications` 每次呼叫 `listTasks`（內含 `fillInstances` 寫入）在 runner 與網頁並存時的安全性**：
  - 經檢查 `src/modules/tasks/db/index.ts` 已開啟 `journal_mode = WAL`（`better-sqlite3` 預設亦有 5 秒 `busy_timeout`），且 `src/modules/tasks/db/schema.ts` 的 `task` 表已有 `uniqueIndex('task_recurrence_occurrence_uq').on(table.recurrenceRuleId, table.occurrenceDate)` 專門防止並發重複補齊。
  - `fillInstances` 本身每條規則各自一個短 transaction，當 `generatedThrough` 已達窗口上限時也不會寫入，實務上每 15 分鐘跑一次幾乎不造成鎖爭用；而且由 runner 呼叫 `listTasks({ today })` 能確保使用者早上還沒開網頁時，08:00 摘要仍能包含當天新展開的重複任務實例。因此維持呼叫 `listTasks({ today })` 即可，不需另寫一套不補齊的查詢。

## 回報(Gemini 填寫)
- 做了什麼(每個檔案一行):
  - `src/modules/tasks/db/schema.ts`: 新增 `taskNotificationSetting`（主鍵 `kind`）、`taskNotificationSent`（`(key, date)` 唯一鍵）與 `habit.reminderTime`
  - `src/modules/tasks/drizzle/0008_futuristic_red_wolf.sql`（及 `meta/`）: 由 `npm run tasks:db:generate` 產生的 migration
  - `src/modules/tasks/server/validation.ts`、`tasks.ts`: 共用 `DUE_TIME_PATTERN` 並匯出 `isTimeOfDay`
  - `src/modules/tasks/lib/habit.ts`: 匯出 `periodEnd`
  - `src/modules/tasks/server/habits.ts`: `createHabit`、`updateHabit` 支援 `reminderTime` 讀寫與驗證
  - `src/modules/tasks/server/notifications.ts`: 實作 `getNotificationSettings`、`saveNotificationSettings`、`dueTaskNotifications`、`markTaskNotificationsSent`（以最後一個 `@` 切分 key，格式不對直接 throw）
  - `src/app/api/tasks/notification-settings/route.ts`: 實作 `GET` / `PUT /api/tasks/notification-settings`
  - `src/jobs/notifiers.ts`: `NOTIFIERS` 加入 `tasks`，以動態 `import()` 載入 tasks 模組
  - `src/jobs/notify-cli.ts`: log 時間戳改為本地時間 `YYYY-MM-DD HH:MM:SS`
  - `docs/tasks/data-model.md`、`api.md`、`backlog.md`: 補上新表、`habit.reminderTime`、端點與進度
- 沒做什麼、為什麼:
  - 未修改 `src/modules/tasks/db/migrations.test.ts` 的 `SEED`（新表不在倒數第二版 schema、`habit.reminder_time` 可空，原測試直接通過）
  - 未做通知設定 UI 與右欄提醒時刻（屬卡 3 範圍）
- 每個完成條件怎麼驗證的:
  - `npx next typegen && npx tsc --noEmit && npm run lint && npm test`：全數通過（`npm test` 81 suites / 621 tests 全過，未改 `src/modules/tasks/server/notifications.test.ts`）
  - 沙盒執行 `PERSONAL_TOOLS_DATA_DIR=/Users/shihsiou/Developer/TT/gemini/personal-tools-data npm run tasks:db:migrate` 與 `npm run notify:tick`：migration 套用成功，tick 輸出 `[2026-11-22 18:42:38] notify tick: sent=0 failed=0`（沙盒資料庫為空，無到期通知）
  - 啟動暫存 dev server（port 3199，指向沙盒資料夾）以 `curl` 測試：
    - `GET /api/tasks/notification-settings` → HTTP 200 回傳預設值 `08:00 / 15:00 / 21:00`
    - `PUT`（`07:30 / 14:00 (false) / 21:30`）→ HTTP 200 更新成功
    - `PUT`（順序不合 `16:00 / 14:00 / 21:30`）→ HTTP 400 `{"error":{"code":"VALIDATION_FAILED","message":"Validation failed","fields":{"times":"out_of_order"}}}`
    - 最後以 `PUT` 還原預設值 → HTTP 200
- 最可能出錯的地方:
  - `fillInstances` 遇到鎖逾時（超過 5 秒）會把錯誤往上丟，runner 那次 tick 會記成 `due` 失敗，下一次 tick 重算
  - `dueTaskNotifications` 若遇到無內容摘要或已達標習慣提醒，會先寫入 `task_notification_sent` 再回傳空／略過，這段寫入若失敗同樣會被記成 `due` 失敗並在下個 tick 重算
- 疑問:
  - 無。
