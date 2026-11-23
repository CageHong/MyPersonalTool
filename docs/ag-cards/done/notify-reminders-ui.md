# notify-reminders-ui:提醒視圖、右欄提醒編輯器、接下來的提醒 API、改規則就地更新

> 先擬計畫:讀完程式碼後在「實作計畫」寫出要改的檔案與步驟,commit 後停下,等主線確認才實作。

## 0. 準備
分支 `gemini/notify-reminders-ui` 由主線從 main 建好,上面有主線寫的測試與這張卡。直接在這個分支上工作。worktree 與假資料規則照 `AGENTS.md`。

## 目標
1. 前端:`docs/tasks/decisions.md` §6j「提醒」表末的兩條前端條目(`view=reminders` 視圖、摘要設定的存法),以及各項目右欄的提醒編輯器
2. 後端:「接下來會送的提醒」(§6j 表末「(2026-11-22 補)」那條)與它的 API
3. 後端:改重複規則時,只有排程欄位改變才重建實例(§6a「(2026-11-22 補)」那條)

卡 3(`done/notify-reminders.md`)做了提醒的表與 CRUD API;這張接在它上面。

## 背景
`docs/tasks/decisions.md` §6j「提醒」、§6a(實例與水位線)、`docs/tasks/api.md`(提醒、摘要設定、新的 `upcoming-notifications`)、`docs/tasks/ui/layout.md`(三欄、網址狀態、寫入佇列)、`docs/tasks/ui/habits.md`(習慣視圖怎麼整組換掉中欄與右欄)、`.claude/rules/tasks.md` 的「前端」段。

要點(規則以 decisions 為準,後端介面以測試為準):
- **後端 2**:`notifications.ts` 新增 `upcomingTaskNotifications(now: Date)` 與型別 `UpcomingNotification`(三種 `kind`,欄位見測試與 `api.md`)。只讀,不呼叫 `markTaskNotificationsSent`。重複規則的實例超過補齊終點時,用 `lib/recurrence.ts` 的 `expandRule` 判斷那天有沒有一次。route:`GET /api/tasks/upcoming-notifications`,`now` 用 `new Date()`。
- **後端 3**:`recurrence.ts` 的 `updateRule`。排程欄位是 `freq`、`interval`、`weekdays`、`startDate`、`until`;沒變時不呼叫 `deleteFutureIncomplete`、不重設水位線,改成更新同一批實例(今天之後、未完成)的 `title`、`notes`、`priority`、`excludeFromSummary`,範本改了就把它們的 checklist 整份換掉。`editedAt` 不動(規則變更不算使用者編輯實例)。
- **視圖 `view=reminders`**:同 `view=habits`,中欄與右欄整組換掉。左欄底部放入口。三區:
  - 三則摘要設定:時刻＋開關。改了就存;不合「早 < 下午 < 晚」時顯示「順序不對,還沒儲存」、不送,改對了自動整份 `PUT /api/tasks/notification-settings`
  - 接下來會送的提醒:`GET /api/tasks/upcoming-notifications`,顯示時刻(今天／明天)與標題;點任務或習慣跳到它的編輯欄(網址狀態照 `layout.md`)。`taskId` 是 null 的(實例還沒產生)點了不跳,或跳到同規則最早的未完成實例,計畫裡選一個並說明
  - 不進摘要的項目:`excludeFromSummary` 為 true 的任務、重複規則、習慣;點了跳到它的編輯欄。重複規則的資料從哪裡來(現有 API 夠不夠)請在計畫裡寫
- **右欄提醒編輯器**(任務、習慣的編輯欄;重複任務的實例編輯的是規則的提醒):
  - 任務:相對「當天／提前 N 天 HH:MM」、絕對「某天 HH:MM」;重複規則:只有相對,N ≤ 6;習慣:每天 HH:MM。每個項目上限 5 則,滿了就不給新增
  - 「不進摘要」開關(任務、規則、習慣既有的 PATCH 都收 `excludeFromSummary`)
  - 寫入照 `.claude/rules/tasks.md`:經過佇列、成功後重抓、不停用控制項、不做樂觀更新
- **錯誤代碼的中文**:加進 `src/modules/tasks/lib/errors.ts`:`times: out_of_order`、`date: in_past`、`reminders: too_many`,以及 `daysBefore` / `kind` / `time` 的 `invalid_value`
- 樣式照根目錄 `CLAUDE.md`「樣式」(只用語意層變數)。不加鍵盤快捷鍵

## 可以改的檔案
- 新增 `src/app/api/tasks/upcoming-notifications/route.ts`
- `src/modules/tasks/server/notifications.ts`、`src/modules/tasks/server/recurrence.ts`
- `src/modules/tasks/components/` 底下:新增提醒視圖與提醒編輯器的元件,改 `CategoryColumn`、任務與習慣的編輯欄、頁面切換視圖的地方
- `src/modules/tasks/lib/`(`views.ts` 加 `reminders` 視圖、`errors.ts`、新的前端型別)
- `src/app/tasks/`(只在視圖切換需要時)
- `src/app/globals.css`(只加語意層變數,指向既有色票)
- `docs/tasks/api.md`(拿掉「尚未實作」)、`docs/tasks/ui/` 新增 `reminders.md`、`docs/tasks/ui/layout.md`(視圖清單)、`docs/tasks/backlog.md`
- 要的話可以加自己的測試檔

## 不能改的檔案
`src/platform/`、`src/jobs/`、`src/modules/tasks/db/`(schema 不動)、`AGENTS.md`、`CLAUDE.md`、`docs/*/decisions.md`。主線的測試不能改。

## 測試(主線提供)
- `src/modules/tasks/server/notifications.test.ts` 的 `describe('upcomingTaskNotifications')`
- `src/modules/tasks/server/recurrence.test.ts` 的 `describe('updateRule: non-schedule changes update instances in place')`

## 完成條件
- `npx next typegen` 後 `npx tsc --noEmit`、`npm run lint`、`npm test` 全過
- 用沙盒資料(`gemini/personal-tools-data/`)在瀏覽器走過:改摘要時刻成錯誤順序再改回來、給任務／規則／習慣各加刪一則提醒、加到第 5 則、開關「不進摘要」後在視圖裡看到它、從視圖點項目跳到編輯欄

## 實作計畫(Gemini 先填,等主線確認)

### 兩個設計選擇的決定

1. **`taskId` 為 `null` 的項目（重複規則的未來實例尚未產生）點了怎麼處理：**
   - **選擇：跳到同規則最早的未完成實例**（使用 `src/modules/tasks/lib/views.ts` 既有的 `earliestIncomplete(tasks, item.ruleId)` 找到實例 `id`，導向 `?view=open&task=<id>`；若該規則目前完全沒有未完成實例，才不跳轉、以不可點擊文字呈現）。
   - **理由**：在 Tasks 介面中重複規則沒有獨立的編輯頁，所有規則提醒與欄位都設在任一實例的右欄裡。讓使用者點了能直接進到最早的未完成實例並編輯該規則的提醒，體驗較一致。

2. **「不進摘要的項目」中，重複規則的資料從哪裡來（現有 API 夠不夠）：**
   - **現況**：現有 API 有 `GET /api/tasks/tasks`（回傳任務實例，含 `recurrenceRuleId`、`excludeFromSummary`）、`GET /api/tasks/habits`（回傳習慣，含 `excludeFromSummary`）、`GET /api/tasks/recurrence-rules/[ruleId]`（單條規則詳情），**沒有**列出所有重複規則的端點。
   - **現有 API 不夠的原因**：若只從現有 `tasks` 篩出 `recurrenceRuleId !== null && excludeFromSummary` 再逐一呼叫 `GET /api/tasks/recurrence-rules/[ruleId]`，會遇到三個問題：(1) 若某條規則目前沒有任何實例（例如 `startDate` 超過 7 天後、或實例都已完成／刪除）會完全漏掉；(2) 若單一實例曾被單獨改過 `excludeFromSummary`，從實例反推會不準確；(3) 產生 N+1 次請求。
   - **建議方案（需主線確認）**：新增 `GET /api/tasks/recurrence-rules`（在 `src/modules/tasks/server/recurrence.ts` 新增 `listRules()`，並新增 `src/app/api/tasks/recurrence-rules/route.ts`）。請主線確認將 `src/app/api/tasks/recurrence-rules/route.ts` 加入「可以改的檔案」；若主線希望維持不新增該路由，替代方案是從 `tasks` 收集不重複的 `recurrenceRuleId` 並呼叫 `GET /api/tasks/recurrence-rules/[ruleId]`（但會有上述無實例規則漏列的限制）。

---

### 要改與新增的檔案

- **後端與 API**：
  - `src/modules/tasks/server/notifications.ts`：新增並 export `UpcomingNotification` 型別與 `upcomingTaskNotifications(now: Date)`。
  - `src/app/api/tasks/upcoming-notifications/route.ts`（新增）：`GET` handler，呼叫 `upcomingTaskNotifications(new Date())`。
  - `src/modules/tasks/server/recurrence.ts`：修改 `updateRule`，判斷排程欄位（`freq`、`interval`、`weekdays`、`startDate`、`until`）是否變更；未變更時就地更新 `occurrenceDate > today` 且未完成的實例（`title`、`notes`、`priority`、`excludeFromSummary`，不動 `editedAt`、`dueDate`、`taskReminder`），若 `checklist` 範本有變則整份替換這些實例的 checklist。另（待確認）新增 `listRules()` 供 `GET /api/tasks/recurrence-rules` 使用。
  - `src/app/api/tasks/recurrence-rules/route.ts`（待主線確認後新增）：`GET` handler 列出重複規則。
- **前端共用型別與純函式 (`src/modules/tasks/lib/`)**：
  - `src/modules/tasks/lib/views.ts`：`ViewId` 與 `VIEWS` 加入 `'reminders'`，`filterByView` 的 `reminders` 回傳 `[]`。
  - `src/modules/tasks/lib/tasks.ts`：`Task` 與 `TaskPatch` 補上 `excludeFromSummary`。
  - `src/modules/tasks/lib/habitView.ts`：`HabitItem` 與 `HabitPatch` 補上 `excludeFromSummary`。
  - `src/modules/tasks/lib/reminders.ts`（新增）：前端型別 `ReminderItem`、`ReminderInput`、`NotificationSettings`、`UpcomingNotificationItem`。
  - `src/modules/tasks/lib/errors.ts`：`DISPLAY_FIELDS` 與 `FIELD_MESSAGES` 補上 `times.out_of_order`、`date.in_past`、`reminders.too_many`、`daysBefore.invalid_value`、`kind.invalid_value`、`time.invalid_value` 的中文訊息，並新增 `reminderMessage`。
- **樣式與 UI 元件**：
  - `src/app/globals.css`：視需要只新增語意層 `--color-*` 變數並指向既有 `--palette-*`。
  - `src/modules/tasks/components/CategoryColumn.tsx` / `.module.css`：在左欄底部日期上方放 `view=reminders` 入口。
  - `src/modules/tasks/components/RemindersView.tsx` / `.module.css`（新增）：實作三區（三則摘要設定、接下來會送的提醒、不進摘要的項目），並接上跳轉至任務／習慣編輯欄。
  - `src/modules/tasks/components/ReminderEditor.tsx` / `.module.css`（新增）：右欄個別提醒編輯器（依任務／重複規則／習慣顯示對應選項、最多 5 則、經佇列寫入與重抓）。
  - `src/modules/tasks/components/TaskDetail.tsx` / `.module.css`：整合 `ReminderEditor`（一般任務傳 `taskId`、重複實例傳 `ruleId`）與「不進摘要」開關。
  - `src/modules/tasks/components/HabitDetail.tsx` / `.module.css`：整合 `ReminderEditor`（傳 `habitId`）與「不進摘要」開關。
  - `src/modules/tasks/components/ThreeColumnLayout.tsx`：支援 `view=reminders` 切換（中欄與右欄整組換掉）、摘要設定與提醒寫入佇列、從提醒視圖跳轉到任務／習慣的網址狀態切換。
- **文件**：
  - `docs/tasks/api.md`、`docs/tasks/ui/reminders.md`（新增）、`docs/tasks/ui/layout.md`、`docs/tasks/backlog.md`。

---

### 實作步驟

1. **後端 API 與核心邏輯**：
   - 實作 `upcomingTaskNotifications(now)` 與 `GET /api/tasks/upcoming-notifications`，確認 `notifications.test.ts` 全過。
   - 實作 `updateRule` 排程未變時的就地更新邏輯，確認 `recurrence.test.ts` 全過。
   - （經主線確認後）實作 `listRules()` 與 `GET /api/tasks/recurrence-rules`。
2. **前端型別與錯誤中文**：
   - 更新 `views.ts`、`tasks.ts`、`habitView.ts`、`errors.ts`，新增 `lib/reminders.ts`。
3. **提醒視圖 (`view=reminders`)**：
   - 在 `CategoryColumn` 左欄底部加入「提醒」入口，在 `ThreeColumnLayout` 接上 `view=reminders` 畫面切換與資料載入（`notification-settings`、`upcoming-notifications`、以及不進摘要項目清單）。
   - 實作 `RemindersView`：摘要時刻順序前端預檢（「順序不對,還沒儲存」不送請求，改對自動整份 `PUT`）、接下來會送的提醒（`taskId === null` 依 `earliestIncomplete` 跳轉）、不進摘要的項目列表與跳轉。
4. **右欄提醒編輯器與「不進摘要」開關**：
   - 實作 `ReminderEditor`（任務相對 0..28 天與絕對、規則相對 0..6 天、習慣每天，上限 5 則，經佇列送出與重抓、不停用控制項）。
   - 整合進 `TaskDetail`（一般任務與重複實例區分）與 `HabitDetail`，並加上「不進摘要」開關。
5. **驗證與文件**：
   - 補齊 `docs/tasks/api.md`、`docs/tasks/ui/reminders.md`、`layout.md`、`backlog.md`。
   - 執行 `npx next typegen`、`npx tsc --noEmit`、`npm run lint`、`npm test`。
   - 使用沙盒資料 `gemini/personal-tools-data/` 在瀏覽器走過所有完成條件的流程。

## 主線確認(2026-11-23)
計畫同意,照計畫實作,加上以下三點:
1. 兩個設計選擇照你的提案。新增 `GET /api/tasks/recurrence-rules`(`listRules()`)與 `src/app/api/tasks/recurrence-rules/route.ts`,加入可以改的檔案;**只列進行中的規則**(`endedAt` 為 null),依 id 升冪。同一次修改更新 `docs/tasks/api.md`。
2. 重複任務實例右欄的「不進摘要」開關,改的是**規則**(`PATCH` 重複規則),不是實例。
3. 新規則(decisions §6j「(2026-11-22 補)重複任務的實例是否『不進摘要』」):`dueTaskNotifications` 判斷重複任務實例時,看規則的 `excludeFromSummary`,不看實例的欄位(今天與逾期、高優先兩組都是)。主線測試在 `notifications.test.ts` 的 `describe('excludeFromSummary on recurring tasks follows the rule')`,已併進這個分支。

## 回報(Gemini 填寫)
- 做了什麼(每個檔案一行):
  - `src/modules/tasks/server/notifications.ts`: 新增 `UpcomingNotification` 型別與 `upcomingTaskNotifications(now)`，並在 `dueTaskNotifications` 中讓重複任務實例的 `excludeFromSummary` 依重複規則欄位判斷（涵蓋今天／逾期與高優先組）。
  - `src/app/api/tasks/upcoming-notifications/route.ts`: 新增 `GET /api/tasks/upcoming-notifications` route handler。
  - `src/modules/tasks/server/recurrence.ts`: 修改 `updateRule` 於排程欄位未變更時就地更新未來未完成實例（含 checklist 範本替換），並新增 `listRules()` 列出進行中規則（`endedAt` 為 null，依 id 升冪）。
  - `src/app/api/tasks/recurrence-rules/route.ts`: 新增 `GET /api/tasks/recurrence-rules` route handler。
  - `src/modules/tasks/lib/views.ts`: `ViewId` 與 `VIEWS` 加入 `'reminders'`，`filterByView` 對 `'reminders'` 回傳空陣列。
  - `src/modules/tasks/lib/tasks.ts`: `Task` 與 `TaskPatch` 加入 `excludeFromSummary?: boolean`。
  - `src/modules/tasks/lib/habitView.ts`: `HabitItem` 與 `HabitPatch` 加入 `excludeFromSummary?: boolean`。
  - `src/modules/tasks/lib/recurrence.ts`: `RecurrenceRuleView` 加入 `title?: string` 與 `excludeFromSummary?: boolean`。
  - `src/modules/tasks/lib/errors.ts`: 加入 `times.out_of_order`、`date.in_past`、`date.invalid_format`、`reminders.too_many`、`daysBefore.invalid_value`、`kind.invalid_value`、`time.invalid_value` 的中文訊息與 `reminderMessage`。
  - `src/modules/tasks/lib/reminders.ts`: 新增提醒與通知設定的前端型別、`areSummaryTimesInOrder` 與 `formatReminderLabel`。
  - `src/modules/tasks/lib/reminders.test.ts`: 新增提醒順序檢查、標籤格式化與錯誤中文訊息的單元測試。
  - `src/modules/tasks/components/CategoryColumn.tsx` / `.module.css`: 左欄底部（今日日期上方）加入「提醒」(`view=reminders`) 檢視入口。
  - `src/modules/tasks/components/RemindersView.tsx` / `.module.css`: 新增提醒視圖元件（每日摘要時刻與開關、接下來會送的提醒、不進摘要的項目，以及點擊項目跳轉至對應編輯欄）。
  - `src/modules/tasks/components/ReminderEditor.tsx` / `.module.css`: 新增右欄個別提醒編輯器（支援一般任務相對／絕對、重複規則相對 0..6 天、習慣每天，上限 5 則，經佇列送出與重抓；審查修正：載入提醒的 `useEffect` 改為只依賴 `query` 字串、由 `query` 判斷 404 訊息，避免父元件每次 render 傳入新 `owner` 物件字面值時重抓）。
  - `src/modules/tasks/components/TaskDetail.tsx`: 整合 `ReminderEditor`（一般任務綁 `taskId`、重複實例綁 `ruleId`）與「不進摘要」開關（重複實例送 `PATCH /api/tasks/recurrence-rules/:ruleId`）。
  - `src/modules/tasks/components/HabitDetail.tsx`: 整合 `ReminderEditor`（綁 `habitId`）與「不進摘要」開關。
  - `src/modules/tasks/components/ThreeColumnLayout.tsx`: 整合 `view=reminders` 視圖切換、通知設定／接下來提醒／進行中規則的讀取與重抓、規則 `excludeFromSummary` 更新，以及從提醒視圖跳轉至任務或習慣編輯欄。
  - `docs/tasks/api.md`: 新增 `GET /api/tasks/recurrence-rules` 並移除 `GET /api/tasks/upcoming-notifications` 的「尚未實作」標記。
  - `docs/tasks/ui/reminders.md`: 新增提醒視圖與右欄提醒編輯器的 UI 規格文件。
  - `docs/tasks/ui/layout.md`: 在三欄檢視說明補上左欄底部的「提醒」(`view=reminders`)。
  - `docs/tasks/backlog.md`: 從開發順序與待做清單移除已完成的通知卡 4 UI 項目。
- 沒做什麼、為什麼:
  - `src/app/globals.css` 與 `src/app/tasks/`: 既有語意層 CSS 變數與路由結構已足夠，無需修改。
  - 未修改 `src/modules/tasks/server/recurrence.test.ts`: 見下方 `tsc` 說明，遵守「主線的測試不能改」規則。
- 每個完成條件怎麼驗證的:
  - `npx next typegen`、`npm run lint`、`npm test`: `next typegen` 成功；`npm run lint` 0 錯誤；`npm test` 680 項測試（含主線的 `upcomingTaskNotifications`、`updateRule: non-schedule changes update instances in place`、`excludeFromSummary on recurring tasks follows the rule` 與新增的 `reminders.test.ts`）全部通過。
  - `npx tsc --noEmit`: 本次修改與新增的所有檔案均無型別錯誤；唯主線提供的 `src/modules/tasks/server/recurrence.test.ts` 第 773 行 `.map((instance) => [instance.occurrenceDate, instance.id])` 未加 `as const`，使 `date` 被推論為 `string | number | null`，在第 779、783 行傳入 `instanceOn(rule.id, date!)` 時報 `TS2345`。依規則不改主線測試，在此回報。
  - 瀏覽器沙盒驗證 (`PERSONAL_TOOLS_DATA_DIR=gemini/personal-tools-data`): 啟動 dev server 並在瀏覽器實際走過：(1) 提醒視圖將早上總覽改為 `16:00` 顯示「順序不對,還沒儲存」，改回 `08:00` 警告消失並自動 `PUT` 儲存；(2) 一般任務新增／刪除提醒、加滿 5 則時新增表單消失並顯示「最多只能設 5 則提醒」；(3) 重複任務實例右欄僅提供相對提醒（當天／提前 1..6 天），新增與刪除提醒，切換「不進摘要」送出規則 `PATCH`；(4) 習慣右欄新增與刪除每天提醒並切換「不進摘要」；(5) 在提醒視圖確認「接下來會送的提醒」與「不進摘要的項目」（任務、重複規則、習慣）皆正確列出，點擊任務與習慣分別跳轉至 `?view=open&task=13` 與 `?view=habits&habit=1` 並開啟右欄編輯面板。
- 最可能出錯的地方:
  - 重複任務實例在右欄切換「不進摘要」時，顯示狀態需優先讀取 `useRecurrenceRule` 載入的 `rule.excludeFromSummary`（因為今天或過去已產生的實例自身的 `task.excludeFromSummary` 不會被 `updateRule` 改寫）；已在 `TaskDetail` 以 `ruleState.rule.excludeFromSummary` 為準，並於 `PATCH` 規則後透過 `refetch()` 遞增 `tasksVersion` 觸發規則與 `recurrenceRules` 同步重抓。
  - `upcomingTaskNotifications` 針對習慣跨日（明天）的達標判斷：需先檢查 `periodStart(remindDateForTime, h.periodType) === h.periodStart`，只有明天與今天仍在同一週期且今天已達標時才略過（例如每日習慣今天已達標，明天是新週期仍要列出）。
- 疑問:
  - `src/modules/tasks/server/recurrence.test.ts` 第 773 行的 `[instance.occurrenceDate, instance.id]` 是否由主線補上 `as const` 以消除 `tsc --noEmit` 在第 779、783 行的 `TS2345`？
