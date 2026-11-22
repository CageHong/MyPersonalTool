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

## 回報(Gemini 填寫)
- 做了什麼(每個檔案一行):
- 沒做什麼、為什麼:
- 每個完成條件怎麼驗證的:
- 最可能出錯的地方:
- 疑問:
