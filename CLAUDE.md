@AGENTS.md

# tasks

個人任務管理系統。這是「personal-tools」平台的第一個工具,之後會有 media tracker、Fog of World 整合、PACR(複式簿記記帳)並存。

已定案的決策與理由記錄在 `docs/decisions.md`。規則衝突時以 `decisions.md` 較新的條目為準;需要推翻其中任何一條時,先停下來問,不要自行改。

## MVP 範圍

只做:任務的建立、列出、勾完成、刪除,資料存進 SQLite,重開瀏覽器還在。

明確**不做**(提出前先問我):積分系統、Google Calendar 同步、共用設計系統、首頁 shell、使用者帳號、部署設定。

## 技術棧

- Next.js App Router + TypeScript
- Drizzle ORM + better-sqlite3
- CSS Modules + CSS 變數(**不用 Tailwind**)

Next.js 的正確寫法一律查 `node_modules/next/dist/docs/01-app/`。
`02-pages/` 是舊的 Pages Router,本專案不使用,不要參考。

## 目錄結構

- `src/app/` — 頁面與路由
- `src/app/api/` — route handler
- `src/server/` — 業務邏輯(純函式)
- `src/db/` — Drizzle schema 與連線
- `src/components/` — UI 元件
- `src/lib/` — 前後端共用的純函式與型別(不碰資料庫與檔案系統)
- `drizzle/` — migration 檔(進版控)
- `data/` — SQLite 檔(不進版控)


## 資料模型

`task` 表(一列 = 一個具體的任務實例,不是重複規則):

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

時間處理規則:

- 絕對瞬間一律存 **Unix 秒數整數**(`createdAt`、`completedAt`、`scheduledAt`)。
- `dueDate` 是**日曆日**,存文字 `YYYY-MM-DD`,不要轉成時間戳(理由見 `docs/decisions.md` §2)。
- `dueDate`、`startDate` 必須是真實存在的日曆日(`isCalendarDate`,在 `src/server/validation.ts`);`2026-02-30` 這種形狀合法但不存在的日期回 `invalid_format`。
- `dueTime` 與 `dueDate` 分開,因為「9/10 到期」和「9/10 15:00 到期」語意不同。
- `durationMinutes` 是長度不是時刻,存分鐘數。
- 完成狀態用 `completedAt` 判斷,**不要**加布林欄位(理由見 `docs/decisions.md` §2)。
- `createdAt` 在 schema 層**沒有**預設值,由 `src/server/` 的建立函式填入 `Math.floor(Date.now() / 1000)`。理由:那是業務規則,不放資料層。

更新規則(`updateTask`):

- 完成狀態收 `done: boolean`,不收 `completedAt`(收到回 `VALIDATION_FAILED`,`fields.completedAt`)。冪等規則同 checklist 項目:未完成時收到 `done: true` → 寫入當下時間;已完成時收到 `done: true` → 保留原值;`done: false` → `null`,已經是 `null` 就不變。
- 其他欄位新值與現有值相同時視為沒有變化(`title` 比 trim 後的值,`priority` 的 `null` 視為 0)。
- 整個 patch 都沒有實際變化時不寫入資料庫。task 表沒有 `updatedAt`。

`task_checklist_item` 表(任務底下的待辦項,**不是**任務——沒有截止日、不排程、不出現在任務清單查詢裡):

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

`task_recurrence_rule` 表(重複規則:日曆規則 + 範本內容;實例是一般的 `task` 列,以 `recurrenceRuleId` 指回):

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `id` | integer PK autoincrement | 否 | |
| `freq` | text | 否 | `daily` / `weekly` / `monthly` / `yearly`,CHECK |
| `interval` | integer | 否 | CHECK `>= 1` |
| `weekdays` | integer | 是 | bitmask,bit 0 = 星期一 … bit 6 = 星期日;`weekly` 時必須 1..127,其他必須 NULL(CHECK) |
| `startDate` | text `YYYY-MM-DD` | 否 | 展開的錨點 |
| `title` / `notes` / `priority` | 同 `task` | | 範本內容 |
| `generatedThrough` | text `YYYY-MM-DD` | 是 | 水位線:實例已產生到哪一天;`null` = 尚未產生 |
| `endedAt` | integer (Unix 秒) | 是 | `null` = 仍在重複 |
| `createdAt` / `updatedAt` | integer (Unix 秒) | 否 | 水位線前進不更新 `updatedAt` |

`task_recurrence_rule_checklist_item` 表(規則的範本 checklist,產生實例時複製成 `task_checklist_item`,全部未勾):

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `id` | integer PK autoincrement | 否 | |
| `ruleId` | integer FK → `task_recurrence_rule.id`,ON DELETE CASCADE | 否 | |
| `title` | text | 否 | |
| `position` | integer | 否 | 同 `task_checklist_item` |
| `createdAt` / `updatedAt` | integer (Unix 秒) | 否 | |

重複任務的規則(函式在 `src/server/recurrence.ts`,日期展開 `expandRule` 在 `src/lib/recurrence.ts`):

- 用到「今天」的函式都以參數接收 `today`,不在函式內讀時鐘;`listTasks()` 查詢前以伺服器本地時區的今天呼叫 `fillInstances`。
- 補齊終點 = 今天 + 6(含),對上「未來 7 天」檢視。
- 建立規則時不回溯:原任務是第一個實例,水位線設為 max(第一個日期, 昨天),規則建立前的日期不產生實例。
- 改規則(`updateRule`)與停止(`stopRule`)先用舊規則補到最新,再刪除今天之後、未完成的實例。

之後才做(現在不要提出實作):

- ~~`recurrence` 表:重複規則(每日/每週/每月),`task` 用 `templateId` 指回。~~ 資料層已完成(R1):`task_recurrence_rule`,`task` 用 `recurrenceRuleId` 指回;API 與 UI 未做。
- 子任務 UI:用既有的 `parentTaskId`。


### priority 的語意

- 值域固定為 0 / 1 / 3 / 5,對映 無 / 低 / 中 / 高。數字大 = 重要。
- 刻意留空隙(2、4 不用),之後插一級不需要改既有資料。
- 資料庫欄位是 NOT NULL DEFAULT 0。應用層接受 null,但在 src/server/ 正規化成 0 再寫入;createTask 未傳時同樣填 0。

## API 設計

端點:

| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api/tasks` | 列出全部;查詢前先補齊重複實例,所以不是 safe,但冪等(水位線 + 唯一鍵) |
| POST | `/api/tasks` | 建立;不可設定 `recurrenceRuleId`、`occurrenceDate`(收到回 `VALIDATION_FAILED`,值為 `not_allowed`) |
| PATCH | `/api/tasks/:id` | 部分更新 `{ title?, notes?, dueDate?, dueTime?, scheduledAt?, durationMinutes?, priority?, parentTaskId?, done? }`;不收 `completedAt`;不可設定 `recurrenceRuleId`、`occurrenceDate`(`not_allowed`) |
| DELETE | `/api/tasks/:id` | 刪除 |
| GET | `/api/tasks/:id/checklist-items` | 列出該任務的 checklist 項目(依 position) |
| POST | `/api/tasks/:id/checklist-items` | 新增項目,放在最後 |
| PUT | `/api/tasks/:id/checklist-items/order` | 重新排序,body `{ itemIds }` 必須恰好是該任務的全部項目 |
| PATCH | `/api/checklist-items/:itemId` | 部分更新 `{ title?, done? }` |
| DELETE | `/api/checklist-items/:itemId` | 刪除 |
| POST | `/api/tasks/:id/recurrence` | 把任務變成重複規則的第一個實例,body `{ freq, interval, weekdays?, startDate }`;成功 201,回傳規則 |
| GET | `/api/recurrence-rules/:ruleId` | 規則欄位加 `checklist: string[]`(範本標題);已停止的規則照樣回傳 |
| PATCH | `/api/recurrence-rules/:ruleId` | 部分更新規則參數與範本 `{ freq?, interval?, weekdays?, startDate?, title?, notes?, priority?, checklist? }`;已停止的規則回 400 |
| POST | `/api/recurrence-rules/:ruleId/stop` | 停止重複,冪等,沒有 body |

用 PATCH 不用 PUT:勾完成只改 `completedAt` 一個欄位,不是整個資源替換。

新增 route 時,`errorResponse`、`handleError`、`parseId`、`readJsonObject` 從 `src/app/api/_lib/http.ts` import,不要在 route 檔內重寫。

錯誤回應一律用 HTTP 狀態碼 + 結構化 JSON:

```json
{ "error": { "code": "VALIDATION_FAILED", "message": "...", "fields": { "title": "required" } } }
```

MVP 只有三種錯誤碼,不要自行增加:

| 狀態碼 | code | 用在 |
|---|---|---|
| 400 | `VALIDATION_FAILED` | 輸入不合法,附 `fields` |
| 404 | `NOT_FOUND` | 指定 id 不存在 |
| 500 | `INTERNAL_ERROR` | 其他所有情況 |

**不要**用「一律回 200,錯誤放 body」的做法。

驗證的位置:

- 驗證邏輯寫在 `src/server/` 的函式裡,不寫在 route handler(理由見 `docs/decisions.md` §1)。
- 驗證失敗時 throw 自訂錯誤類別(帶 `fields` 資訊),定義在 `src/server/`。
- route handler 用 `instanceof` 判斷錯誤類別,對映到狀態碼。`src/server/` 不可以知道 HTTP 的存在——不 import Next.js 的任何東西,不回傳 Response。

驗證 vs 解析的判準:這條規則在**非 HTTP 的呼叫路徑**上還成立嗎?

- 成立(例:title 不能為空)→ 業務驗證,寫在 `src/server/`
- 不成立(例:網址上的 id 是 "abc"、body 不是合法 JSON)→ 協定層解析,寫在 route handler,同樣回 `VALIDATION_FAILED`


### GET /api/tasks 的回傳順序

- 排序在 `listTasks()` 裡用 SQL `ORDER BY` 完成,route handler 與前端不排序。
- 順序:未完成在前(`completedAt IS NULL`),已完成在後;同一組內 `createdAt` 升冪,再以 `id` 升冪打破平手。
- `dueDate`、`priority` 目前不參與排序。
- `listTasks()` 接受一個排序選項參數,`ORDER BY` 從白名單組出;現在只有一種選項(上述預設),之後加 `?sort=` 時只加選項,不改函式形狀。

## 前端

**資料一律走 HTTP。** 畫面用 Client Component,以 `fetch('/api/tasks')` 取資料。不要在頁面或元件直接 import `src/server/`(型別也不行),不要用 Server Action。理由見 `docs/decisions.md` §4。

**樣式一律 CSS Modules。** 元件的 `.module.css` 不可以寫死顏色、間距、圓角、字級、字重、字型,一律引用 `src/app/globals.css` `:root` 的變數。需要新的值先加進 `:root`,不要在元件裡寫數值。

**寫入不停用控制項。** 任務與 checklist 的寫入都經過佇列,每個動作等前一個(含重抓)完成才開始,期間**不**用 `disabled` 或 `readOnly` 擋控制項(例外:ConfirmDialog 的確認鈕);防重複送出用 ref(如 `pendingRef`)。理由見 `docs/decisions.md` §5。

**停用樣式一律延遲顯示。** 擋住操作的狀態(disabled、readOnly)的外觀,變化都要延遲
--disabled-delay 才發生,回到啟用狀態時立即恢復。目前適用:ConfirmDialog 的確認鈕。理由見 `docs/decisions.md` §4。

**CSS 變數分兩層**(理由見 `docs/decisions.md` §7):

- 色票層 `--palette-*`:名字只描述顏色本身,不帶用途。
- 語意層 `--color-*`:名字描述用途,值一律指向色票層。

**元件只能引用語意層**,不得引用 `--palette-*`。需要新顏色時先看語意層有沒有合適的名字;沒有就新增語意變數指向既有色票,新增色票要先問。間距只能用 `--space-1` 到 `--space-5`,字級只能用 `--text-xs` 到 `--text-lg`。

**畫面更新一律重新抓。** 任何寫入操作(POST / PATCH / DELETE)成功後,重新 `GET /api/tasks`,用回傳結果整份替換 state。不要拿回應的物件去局部更新 state,不要做樂觀更新(例外:checklist 拖曳排序,見 UI 架構)。理由見 `docs/decisions.md` §4。

現階段不做深色模式,不做共用設計系統。

## 介面架構

三欄版面(左到右):

| 欄 | 職責 |
|---|---|
| 分類欄 | 智慧檢視清單;決定第二欄顯示哪些任務 |
| 任務清單 | 頂端是新增列,下方是任務列;點任務列選取它 |
| 編輯欄 | 顯示被選取的任務,各欄位可編輯 |

本輪的智慧檢視只有查詢條件,沒有自訂清單表:今天、未來 7 天、全部未完成、已完成。

**選取狀態放在網址。** `?view=today&task=123`。`view` 是分類欄選的檢視,`task` 是被選取的任務 id;沒有 `task` 時編輯欄顯示空狀態。`useSearchParams` 在 `ThreeColumnLayout` 讀一次往下傳,用 `router.replace` 寫。不要用元件內的 state 存這兩個值。理由見 `docs/decisions.md` §4。

**每個欄位各自儲存,各自送一次 PATCH。**

| 欄位 | 儲存時機 |
|---|---|
| 標題 | 失焦即存 |
| 描述 | 失焦即存 |
| 優先級 | 點選即存 |
| 截止日 | 選好按確定才存 |
| checklist 項目 | 勾選即存;文字失焦或 Enter 存;新增列按 Enter 送出;刪除不跳確認 |

**編輯中的輸入框不被重抓覆蓋。** 標題與描述在聚焦期間,值由該輸入框自己的 local state 持有;失焦後才跟隨伺服器資料。這是「畫面更新一律重新抓」的唯一例外,理由是慢網路下重抓回來的舊值會蓋掉使用者正在打的字。

**欄位被伺服器拒絕時保留輸入值。** 送出的值被擋下來時,輸入框留著使用者打的內容,不還原成伺服器的值;輸入框標示錯誤狀態,訊息畫在該欄位下方。使用者一修改該欄位就清掉錯誤。中欄任務列顯示的仍是伺服器的值。

**錯誤訊息一律中文。** 錯誤代碼在 `src/lib/errors.ts` 轉成中文,對應不到的代碼也要有中文 fallback,不要把 API 的英文訊息漏到畫面上。欄位層級的錯誤畫在該欄位下方;其餘(404、500、網路失敗)顯示在中欄新增列下方。

**右欄的狀態生命週期綁在掛載上。** `TaskDetail` 以 `key={task.id}` 掛載,切換任務時欄位草稿、錯誤訊息、確認彈窗狀態隨卸載清除,不要另外寫 effect 逐一清(理由見 `docs/decisions.md` §4)。

**對話框一律經 `dialog.close()` 關閉。** 確定、清除、取消、Esc、背景點擊走同一條路徑:先 `close()`,再由 `<dialog>` 的 close 事件通知父層,並在 close 事件中明確把焦點移回觸發鈕;會卸載觸發鈕的動作(如確認刪除)除外。不要讓父層直接卸載開啟中的 `<dialog>`。理由見 `docs/decisions.md` §5。

描述是純文字,不做 Markdown 渲染。

**任務寫入由 `ThreeColumnLayout` 排隊。** `mutate` 被呼叫的當下(事件處理中)記錄焦點所在的任務、它在中欄的索引、焦點在哪一類控制項(中欄勾選框、中欄的列、右欄),連同寫入一起排入佇列。重抓完成後,若該任務已不在目前視圖的清單裡、且焦點已掉到 body,焦點移到遞補列(下一列 → 上一列 → 中欄容器);原本在勾選框就移到遞補列的勾選框,其他情況移到遞補列的標題。刪除、勾完成、改欄位離開篩選共用這一套,`handleDelete` 不自己處理焦點。任務仍在視圖裡時不動焦點。

**checklist 在右欄描述下方,由 `TaskChecklist` 自己載入與寫入。** 寫入排隊執行,每個動作等前一個(含重抓)完成才開始,期間**不停用**任何控制項:有焦點的元素被停用會把焦點丟到 body,編輯中直接點刪除鈕的 click 也會被吞掉。刪除後焦點落到遞補的那一項 → 前一項 → 新增列。

**checklist 可拖曳排序(依賴 `@dnd-kit/core`、`@dnd-kit/sortable`、`@dnd-kit/utilities`)。** 只有每列左側的把手能啟動拖曳(滑鼠移動 5px 或鍵盤空白鍵/Enter);寫入排隊中不能開始拖曳,由感應器判斷,不用 `disabled`。放下後直接改 `items`(樂觀更新,全 app 唯一的樂觀更新),再排入 `PUT …/order`,完成後照常重抓;失敗時重抓還原。放下後焦點留在把手上。朗讀文字為中文。

**右欄的「重複」列在優先級下方,依任務狀態顯示三種樣子。** 實例(`recurrenceRuleId` 不為 null)顯示唯讀的規則摘要;未完成的一般任務顯示「重複」選單;已完成的一般任務整列不顯示。修改規則與停止重複尚未提供。

**「重複」選單(`RecurrenceMenu` + `RecurrenceDialog`)照 `DueDateMenu` 的做法。** 開啟時才掛載,所有關閉路徑經 `dialog.close()`,close 事件先把焦點移回觸發鈕再送出。錨點是任務的截止日,沒有就是今天,選單內不提供日期欄位。每次開啟的預設:每天、間隔 1、每週的星期幾勾錨點那天。按確定時才驗證(間隔 1–99 的整數、每週至少一天),不停用確定鈕,不合法就留在選單裡把訊息畫在欄位下方。預覽用 `upcomingOccurrences` 顯示接下來 4 個日期,和伺服器實際產生的實例一致(第一個是原任務,之後從今天起,不回溯),下方一行是 `describeRule` 的摘要。送出經 `ThreeColumnLayout` 的寫入佇列(`mutate`),防重複送出用 `pendingRef`,完成後一律重設。成功後任務變成實例、按鈕被摘要取代:任務仍在視圖裡時焦點落到摘要(送出前立 `focusSummaryRef` 旗標,由 `RecurrenceSummary` 掛載後、焦點在 body 時接手);任務離開視圖時照「任務寫入由 `ThreeColumnLayout` 排隊」的遞補規則。

**規則摘要(`RecurrenceSummary`)自己載入 `GET /api/recurrence-rules/:ruleId`。** 顯示 `describeRule`,已停止的規則加註「已停止重複」。競態靠 `TaskDetail` 的 `key={task.id}` 重新掛載,effect 的 cleanup 另外標記過期,舊回應不寫 state。載入失敗的訊息照 checklist 的方式顯示在中欄新增列下方。

**重複實例在列表視圖收合成每條規則一列。** `filterTasks` 的第一步是 `collapseRecurring`,之後才套各視圖的日期條件:每條規則的未完成實例只留一個代表(`dueDate` 最早,`null` 排最後;平手比 `occurrenceDate`,再比 `id`),同組中代表以外 `dueDate < today` 的未完成實例數標在代表那一列(「+N 逾期」)。先收合、後篩選,所有視圖共用同一個代表:代表是這條規則現在活著的實例,不隨視圖而變;有下限的視圖(某一天、「明天」)出現時,先篩選會在 9/17 未完成時把 9/18 選為代表(理由見 `docs/decisions.md` §6a)。已完成的實例是紀錄,不收合;一般任務原樣保留。收合只移除、不重排,順序仍是 `listTasks()` 的 ORDER BY。非代表的實例不在清單裡,也選不到。任務列 `.meta` 依序是重複圖示、「+N 逾期」、日期,都不縮。`totalCount` 仍是收合前的全部任務數,只用來分辨空狀態。

之後才做(現在不要提出實作):自訂清單(需要 `list` 表與 `task.listId`)、重複任務、習慣。(重複任務的資料層已完成,API 與 UI 未做。)

## 待處理事項

- 初次載入失敗與寫入失敗顯示在同一個位置(新增列下方),看不出是哪一種來源,待與錯誤訊息的位置一起檢討。
- CategoryColumn 的「今天」在伺服器端與瀏覽器端可能不一致(`/` 是靜態頁面,日期在建置時固定),會造成 hydration 錯誤與整棵子樹重新產生。與 `views.ts` 的日期篩選、相對日期顯示屬於同一類問題,待統一處理。
- `task.parentTaskId` 的外鍵沒有指定 `onDelete`,且連線開啟 `foreign_keys = ON`,刪除有子任務的父任務會失敗(500)。做 checklist 或子任務時必須先決定刪除行為。

## 工作流程:依風險分級

指令會標明是哪一級。**沒標明時視為高風險。**

**低風險步驟**:只改 CSS 值或變數名稱、刪除沒有引用的程式碼、不改變任何行為。

- 可以直接實作,不必先交計畫。
- 完成後回報:改了哪些檔案、每個檔案改了什麼(一行)、`tsc` 與 `lint` 結果。
- 過程中發現需要改變行為,或範圍超出指令,停下來回報,不要自行擴大。

**高風險步驟**:涉及 state、effect、焦點管理、資料流、API、schema。

- 先列出要改的檔案與做法,等確認再寫。

## 紀律

1. **業務邏輯一律寫在 `src/server/` 的純函式。** route handler 只做三件事:解析請求、呼叫 `src/server/` 的函式、回傳 JSON。不要在 route handler 裡寫任何邏輯或直接碰資料庫。理由見 `docs/decisions.md` §1。
2. `data/` 必須在 `.gitignore` 裡。
3. 一次只做一個垂直切片,結束時必須是跑得起來、可以 commit 的狀態。

## 語言

與我對話一律用**繁體中文**。程式碼、變數名、commit message 用英文。