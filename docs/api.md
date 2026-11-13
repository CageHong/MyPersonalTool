# API

端點清單與回傳順序。**新增或修改 route 前讀這一份。**

錯誤形狀、錯誤碼、驗證該寫在哪一層是全域契約,放在 `CLAUDE.md`,不在這裡重複。

事實來源是 `src/app/api/` 底下的檔案;本檔與程式碼不一致時以程式碼為準,並在同一次修改裡更新本檔。

## 端點

| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api/tasks` | 列出全部;查詢前先補齊重複實例,所以不是 safe,但冪等(水位線 + 唯一鍵) |
| POST | `/api/tasks` | 建立;不可設定 `recurrenceRuleId`、`occurrenceDate`(收到回 `VALIDATION_FAILED`,值為 `not_allowed`) |
| POST | `/api/tasks/batch` | 批次建立 `{ tasks: [...] }`(每筆同 POST `/api/tasks` 的 body),1 到 100 筆,整批成功才寫入;成功 201,回傳陣列。錯誤的 `fields` key 是「索引.欄位」 |
| PATCH | `/api/tasks/:id` | 部分更新 `{ title?, notes?, dueDate?, dueTime?, scheduledAt?, durationMinutes?, priority?, parentTaskId?, pinned?, done? }`;不收 `completedAt`;不可設定 `recurrenceRuleId`、`occurrenceDate`(`not_allowed`) |
| DELETE | `/api/tasks/:id` | 刪除 |
| GET | `/api/tasks/:id/checklist-items` | 列出該任務的 checklist 項目(依 position) |
| POST | `/api/tasks/:id/checklist-items` | 新增項目,放在最後 |
| POST | `/api/tasks/:id/checklist-items/batch` | 批次新增 `{ titles: [...] }`,1 到 100 筆,整批放在最後,整批成功才寫入;成功 201 |
| PUT | `/api/tasks/:id/checklist-items/order` | 重新排序,body `{ itemIds }` 必須恰好是該任務的全部項目 |
| PATCH | `/api/checklist-items/:itemId` | 部分更新 `{ title?, done? }` |
| DELETE | `/api/checklist-items/:itemId` | 刪除 |
| POST | `/api/tasks/:id/recurrence` | 把任務變成重複規則的第一個實例,body `{ freq, interval, weekdays?, startDate, until? }`(`until` 早於第一個日期回 `before_start`);成功 201,回傳規則 |
| GET | `/api/recurrence-rules/:ruleId` | 規則欄位加 `checklist: string[]`(範本標題);已停止的規則照樣回傳 |
| PATCH | `/api/recurrence-rules/:ruleId` | 部分更新規則參數與範本 `{ freq?, interval?, weekdays?, startDate?, until?, title?, notes?, priority?, checklist? }`(`until: null` = 改回永不結束);已停止的規則回 400 |
| POST | `/api/recurrence-rules/:ruleId/stop` | 停止重複,冪等,沒有 body |
| GET | `/api/list-views` | 列出存過的清單呈現設定 `[{ listKey, groupBy, sortBy, sortDirection, updatedAt }]`;沒存過的清單不在裡面,由前端套預設值 |
| PUT | `/api/list-views/:listKey` | 整份替換某個清單的設定 `{ groupBy, sortBy, sortDirection }`(upsert,冪等);`listKey` 只能是 `today` / `next7` / `open` / `done` |
| GET | `/api/habits` | 列出全部(依 `sortOrder`),每筆加 `paused`、`periodStart`、`progress { count, target, achieved }`、`streak`、`periodCounts`(本週期內有紀錄的日期與筆數,新的在前)、`totalLogs`(全期筆數) |
| POST | `/api/habits` | 建立 `{ name, periodType, target? }`;成功 201 |
| PATCH | `/api/habits/:habitId` | 部分更新 `{ name?, periodType?, target? }` |
| DELETE | `/api/habits/:habitId` | 硬刪除,連同 log、設定歷史、停止區間 |
| POST | `/api/habits/:habitId/logs` | 記一次 `{ date }`;成功 201 |
| PUT | `/api/habits/:habitId/logs?date=YYYY-MM-DD` | 把該日期設成 `{ count }` 筆(絕對值),回 `{ date, count }`;刪時刪最新的幾筆,`count: 0` 是清空。UI 的計數一律走這裡 |
| DELETE | `/api/habits/:habitId/logs?date=YYYY-MM-DD` | 刪該日期最新的一筆;日期放 query string,不放 body |
| POST | `/api/habits/:habitId/pause` | 停止,沒有 body;已停止時 400,不冪等 |
| POST | `/api/habits/:habitId/resume` | 恢復,沒有 body;未停止時 400 |

用 PATCH 不用 PUT:勾完成只改 `completedAt` 一個欄位,不是整個資源替換。

新增 route 時,`errorResponse`、`handleError`、`parseId`、`readJsonObject` 從 `src/app/api/_lib/http.ts` import,不要在 route 檔內重寫。

## `GET /api/tasks` 的回傳順序

- 排序在 `listTasks()` 裡用 SQL `ORDER BY` 完成,route handler 與前端不排序。
- 順序:未完成在前(`completedAt IS NULL`),已完成在後;同一組內 `createdAt` 升冪,再以 `id` 升冪打破平手。
- 這是 API 的預設順序。畫面上各清單的分組、排序、置頂由前端的 `arrangeTasks`(`src/lib/listView.ts`)在篩選之後計算,不走 `?sort=`(理由見 `docs/decisions.md` §6d)。
- `listTasks()` 仍接受排序選項參數,`ORDER BY` 從白名單組出;現在只有一種選項(上述預設)。
