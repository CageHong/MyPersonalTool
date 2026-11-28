# tasks-trash:任務的垃圾桶

**先擬計畫。** 讀完程式碼後在「實作計畫」寫出要改的檔案與步驟,commit 後停下,等主線確認才實作。

## 0. 準備
分支 `gemini/tasks-trash` 已由主線從 main 建好,上面有主線寫的測試(見「測試」)。直接在這個分支上工作。worktree 與假資料規則照 `AGENTS.md`。

## 目標
實作 `docs/tasks/decisions.md` §6h「垃圾桶這一輪」整張表:任務的軟刪除、垃圾桶視圖、還原、永久刪除、清空。規則以 decisions 為準,這裡不重述。

## 背景
`CLAUDE.md`、`.claude/rules/tasks.md`、`docs/tasks/data-model.md`、`docs/tasks/api.md`、`docs/tasks/ui/layout.md`、`docs/tasks/decisions.md` §6a(錯過就跳過)、§6h。

要點:
- `task` 加可空欄位 `deletedAt`(`deleted_at`,Unix 秒)。測試用 SQL 讀寫 `deleted_at`,欄位名要一致。
- 伺服器端函式(測試匯入的名字):`tasks.ts` 的 `deleteTask` 改成丟進垃圾桶;新增 `server/trash.ts`:`listTrash()`、`restoreTask(id)`(回傳還原後的任務)、`purgeTask(id)`、`emptyTrash()`(回傳刪掉的筆數)。伺服器的 `Task` 回傳多一個 `deletedAt`。
- 「查詢預設排除」:`listTasks` 排除垃圾桶;會寫入或檢查任務存在的地方(`updateTask`、`checklist.ts` 的 `assertTaskExists` 與以 item id 找任務的寫入、`reminders.ts` 的 `assertOwnerExists`、`recurrence.ts` 的 `createRuleFromTask`)把垃圾桶裡的任務當作不存在。`listChecklistItems` 例外:右欄要能唯讀顯示垃圾桶裡任務的 checklist。
- 重複任務:`deleteFutureIncomplete` 不加 `deletedAt` 條件(垃圾桶裡的未來實例一起刪);`deleteMissedUntouched` 要排除垃圾桶裡的。通知只透過 `listTasks` 拿任務,應該不用改,用測試確認。
- API 照 §6h 的端點表;route handler 只解析、呼叫、回傳。
- 前端:`lib/tasks.ts` 的 `Task` 加 `deletedAt?: number | null`(選填,`lib/*.test.ts` 的假資料不用改);`lib/views.ts` 的 `VIEWS` 最後加 `{ id: 'trash', label: '垃圾桶' }`;中欄在 `trash` 視圖抓 `GET /api/tasks/trash`,沒有新增列、沒有分組排序設定;右欄唯讀(不能編輯欄位、checklist、提醒),只有「還原」「永久刪除」;中欄頂端或底部放「清空垃圾桶」。永久刪除與清空用既有的 `ConfirmDialog`;`TaskDetail` 原本刪除前的確認拿掉。寫入後照規則重抓(`GET /api/tasks/tasks`,在垃圾桶視圖時再加 `GET /api/tasks/trash`),不做樂觀更新,寫入走既有的佇列。
- 有子任務的母任務不處理(§6h 最後一列)。

## 可以改的檔案
- `src/modules/tasks/db/schema.ts`、`npm run tasks:db:generate` 產生的 migration、`src/modules/tasks/db/migrations.test.ts` 的種子
- `src/modules/tasks/server/tasks.ts`、`checklist.ts`、`reminders.ts`、`recurrence.ts`,新增 `server/trash.ts`
- `src/app/api/tasks/trash/` 底下的新 route(`route.ts`、`[id]/route.ts`、`[id]/restore/route.ts`)
- `src/modules/tasks/lib/tasks.ts`、`lib/views.ts`、`lib/errors.ts`(要新的中文訊息的話)
- `src/modules/tasks/components/` 的 `CategoryColumn`、`TaskList`、`TaskDetail`、`ThreeColumnLayout` 與它們的 `.module.css`;需要新元件可以新增在 `components/`
- `docs/tasks/data-model.md`、`docs/tasks/api.md`、`docs/tasks/ui/layout.md`

## 不能改的檔案
`docs/tasks/decisions.md`、`docs/tasks/backlog.md`、`AGENTS.md`、`CLAUDE.md`、`.claude/rules/`、`src/platform/`、`src/app/globals.css`(要新的 CSS 變數就停下寫進回報)、`server/notifications.ts`(測試不過才回報,不要直接改)。主線的測試(下節)不能改。

## 測試(主線提供)
- `src/modules/tasks/server/trash.test.ts`(新):軟刪除、`listTrash` 的排序、還原、永久刪除、清空、唯讀、重複實例在垃圾桶裡的三種情況
- `src/modules/tasks/server/notifications.test.ts`:新的 `tasks in the trash` 區塊
- `src/modules/tasks/server/checklist.test.ts`、`reminders.test.ts`:cascade 的測試改成「丟進垃圾桶保留、永久刪除才刪」
- `src/modules/tasks/server/recurrence.test.ts`:`a deleted instance is not regenerated` 改成用 `listTasks` 看
- `src/modules/tasks/lib/views.test.ts`:`trash view`

現在這些檔案因為 `./trash` 不存在而整份失敗,是預期的。測試就是規格;覺得測試有錯就停下,寫進回報。

## 完成條件
- `npx next typegen` 後 `npx tsc --noEmit`、`npm run lint`、`npm test` 全過(含 `db/migrations.test.ts`)
- 在沙盒資料(`gemini/personal-tools-data/`)上 `npm run dev` 手動驗證並寫進回報:
  1. 刪除一筆有 checklist 的今天任務:不跳確認,從「今天」消失,出現在「垃圾桶」;右欄唯讀、看得到 checklist
  2. 還原:回到「今天」,checklist 還在
  3. 刪一筆重複任務明天的實例,重新整理後不會再長出來
  4. 永久刪除與清空都要先確認;取消時什麼都不變
- **不要**對正式資料(`personal-tools-data/`)執行任何指令
- commit 前綴 `tasks:`

## 實作計畫(標「先擬計畫」時,Gemini 先填,等主線確認)

### 預計修改／新增的檔案

1. **Schema、Migration 與測試種子**
   - `src/modules/tasks/db/schema.ts`：`task` 表新增可空欄位 `deletedAt: integer('deleted_at')`（Unix 秒，`null` 表示未在垃圾桶）。
   - `src/modules/tasks/drizzle/`：執行 `npm run tasks:db:generate` 產生 `0012_*.sql` 與對應 snapshot／`_journal.json`（不手改產出檔與既有 migration）。
   - `src/modules/tasks/db/migrations.test.ts`：將 `SEED` 更新為倒數第二版（`0011`）的 schema——移除 `INSERT INTO habit` 裡的 `reminder_time` 欄位（該欄位已在 `0011` 移除）。

2. **伺服器端邏輯（`src/modules/tasks/server/`）**
   - `src/modules/tasks/server/tasks.ts`：
     - `listTasks`：加上 `.where(isNull(task.deletedAt))`，排除垃圾桶任務。
     - `updateTask`：查既有列改為 `and(eq(task.id, id), isNull(task.deletedAt))`，垃圾桶內任務視為不存在（拋 `NotFoundError`）且不寫入。
     - `deleteTask`：改為軟刪除——`update(task).set({ deletedAt: Math.floor(Date.now() / 1000) }).where(and(eq(task.id, id), isNull(task.deletedAt)))`，不動 `editedAt` 等其他欄位；找不到或已在垃圾桶內拋 `NotFoundError`。
   - `src/modules/tasks/server/trash.ts`（新增）：
     - `listTrash(): Task[]`：查 `isNotNull(task.deletedAt)`，依 `desc(task.deletedAt), desc(task.id)` 排序。
     - `restoreTask(id: number): Task`：在 `and(eq(task.id, id), isNotNull(task.deletedAt))` 條件下將 `deletedAt` 設回 `null` 並回傳整列；找不到或非垃圾桶任務拋 `NotFoundError`。
     - `purgeTask(id: number): void`：在 `and(eq(task.id, id), isNotNull(task.deletedAt))` 條件下硬刪（外鍵 `ON DELETE CASCADE` 一併刪除 checklist 與提醒）；找不到或非垃圾桶任務拋 `NotFoundError`。
     - `emptyTrash(): number`：硬刪所有 `isNotNull(task.deletedAt)` 的列並回傳刪除筆數（空垃圾桶回 `0`）。
   - `src/modules/tasks/server/checklist.ts`：
     - 拆出 `assertLiveTaskExists`（檢查 `id` 且 `deletedAt IS NULL`）與 `assertAnyTaskExists`（僅檢查 `id`）。
     - `listChecklistItems` 改用 `assertAnyTaskExists`（右欄可唯讀顯示垃圾桶任務的 checklist）。
     - `createChecklistItem`、`createChecklistItems`、`reorderChecklistItems` 改用 `assertLiveTaskExists`。
     - `updateChecklistItem`、`deleteChecklistItem`：查到項目後加驗其所屬任務未在垃圾桶（`assertLiveTaskExists(tx, existing.taskId)`），若在垃圾桶則拋 `NotFoundError` 且不寫入／不刪除。
   - `src/modules/tasks/server/reminders.ts`：
     - `assertOwnerExists`：當 `kind === 'task'` 時加上 `isNull(task.deletedAt)`。
     - `updateReminder`、`deleteReminder`：包在 transaction 內，若該提醒屬於任務（`existing.taskId !== null`）同樣呼叫 `assertOwnerExists(tx, 'task', existing.taskId)`，避免修改或刪除垃圾桶任務的提醒。
   - `src/modules/tasks/server/recurrence.ts`：
     - `deleteFutureIncomplete`：**不加** `deletedAt` 條件，讓改排程與停止重複時連垃圾桶裡的未來未完成實例一起硬刪。
     - `deleteMissedUntouched`：加上 `isNull(task.deletedAt)`，不動垃圾桶裡的實例。
     - `createRuleFromTask`：查來源任務加上 `isNull(task.deletedAt)`，垃圾桶內任務拋 `NotFoundError`。
     - `updateRule` 非排程欄位就地更新的 `futureIncompleteCondition`：加上 `isNull(task.deletedAt)`，避免改寫垃圾桶內的實例（見下方疑問 3）。
   - `src/modules/tasks/server/notifications.ts`：不改（完全透過 `listTasks` 取得任務，既有邏輯即可通過 `notifications.test.ts` 新增測試，實作後以測試驗證）。

3. **API Route Handlers（`src/app/api/tasks/trash/`，新增）**
   - `src/app/api/tasks/trash/route.ts`：
     - `GET`：呼叫 `listTrash()`，回 `200` JSON 陣列。
     - `DELETE`：呼叫 `emptyTrash()`，回 `200` `{ deleted: count }`（見下方疑問 1）。
   - `src/app/api/tasks/trash/[id]/route.ts`：
     - `DELETE`：`parseId` 解析 `id` 後呼叫 `purgeTask(id)`，成功回 `204`，錯誤走 `handleError`。
   - `src/app/api/tasks/trash/[id]/restore/route.ts`：
     - `POST`：`parseId` 解析 `id` 後呼叫 `restoreTask(id)`，成功回 `200` JSON（還原後的 task），錯誤走 `handleError`。
   - （`src/app/api/tasks/tasks/[id]/route.ts` 不需修改，原本已呼叫 `deleteTask(id)` 並將 `NotFoundError` 轉 404。）

4. **前端共用的型別與工具（`src/modules/tasks/lib/`）**
   - `src/modules/tasks/lib/tasks.ts`：`Task` 型別新增選填欄位 `deletedAt?: number | null`。
   - `src/modules/tasks/lib/views.ts`：`ViewId` 加入 `'trash'`，`VIEWS` 最尾端加入 `{ id: 'trash', label: '垃圾桶' }`，`filterByView` 新增 `case 'trash': return []`（`listView.ts` 的 `listKeyOf('trash')` 會自動回 `null`，不需改）。
   - `src/modules/tasks/lib/errors.ts`：視需要新增 `trashMessage`（404 顯示「找不到這個任務,可能已被還原或永久刪除」），其餘共用 `generalMessage`。

5. **前端元件（`src/modules/tasks/components/`）**
   - `src/modules/tasks/components/CategoryColumn.tsx`：不改或僅補註解——目前 `reminders` 掛 `.bottomView`（`margin-top: auto`），`VIEWS` 尾端加上 `trash` 後，`提醒` 與 `垃圾桶` 會一起靠在左欄底部、且 `垃圾桶` 在最底端（日期上方）。
   - `src/modules/tasks/components/TaskDetail.tsx`：
     - 移除刪除前的 `ConfirmDialog` 與 `confirmingId` 狀態；點「刪除」直接呼叫 `onDelete(task.id)`。
     - 用 `deletePendingRef` 防止連點重複送出（不停用按鈕，符合寫入佇列規則）。
   - `src/modules/tasks/components/TrashList.tsx` & `TrashList.module.css`（新增；比照 `HabitList` 拆分，避免改動未在允許清單內的 `TaskItem`）：
     - 頂端標題列：左端 `leftToggle` +「垃圾桶」，右端在非空且載入完成時顯示「清空垃圾桶」按鈕 + `rightToggle`（無 `ViewSettingsMenu`、無 `NewTaskForm`）。
     - 「清空垃圾桶」點擊開啟 `ConfirmDialog`（`tone="destructive"`，預設焦點在取消），確認後呼叫 `onEmpty()`。
     - 顯示載入骨架（`TaskListSkeleton`）、泛用錯誤訊息、空狀態（「垃圾桶是空的」）。
     - 任務列無勾選框（唯讀），依伺服器順序（`deletedAt` 新到舊）顯示標題（已完成帶刪除線）、重複圖示、截止日／刪除日期；保留 `li[data-task-id]` 與按鈕 `data-task-control="row"`，讓 `ThreeColumnLayout` 的焦點遞補與抽屜關閉歸還焦點可直接沿用。
   - `src/modules/tasks/components/TrashDetail.tsx` & `TrashDetail.module.css`（新增；比照 `HabitDetail` 拆分，避免改動未在允許清單內的 `TaskChecklist` / `ReminderEditor`）：
     - 未選取時顯示「未選取任務」。
     - 選取時包在 `<article data-task-id={task.id}>` 內，全部欄位唯讀呈現：標題、描述、checklist（呼叫 `GET /api/tasks/tasks/${task.id}/checklist-items` 唯讀顯示勾選狀態與文字，無輸入框／拖曳／新增／刪除）、截止日（含原定日若有移動）、優先級、置頂狀態、重複摘要（若有 `recurrenceRuleId`，用 `useRecurrenceRule` + `describeRule` 唯讀文字顯示）、刪除日期。不呼叫提醒 API 也不畫提醒編輯器。
     - 底部放置「還原」（以 `restorePendingRef` 防重複送出，不停用）與「永久刪除」（開啟 `ConfirmDialog`，確認狀態存 `confirmingId: number | null`，預設焦點在取消）。
     - 樣式一律只引用 `src/app/globals.css` 既有的 `--color-*`、`--space-*`、`--text-*`、`--radius` 等語意變數，不新增 CSS 變數。
   - `src/modules/tasks/components/ThreeColumnLayout.tsx`：
     - 新增 `trashedTasks` 與 `trashLoading` 狀態及 `refetchTrash()`（內含 `flushSync` 以便寫入後同步遞補焦點）。
     - 進入 `view === 'trash'` 時以 `useEffect` 抓取 `GET /api/tasks/trash`（透過 render 期偵測切換進 `trash` 設 `trashLoading = true`，避免重新整理或上一頁回到 `?view=trash&task=ID` 時被網址清理 effect 誤清 `task`，也不觸發 `set-state-in-effect` lint）。
     - `selectedTask` 在 `view === 'trash'` 時從 `trashedTasks` 找，網址清理 effect 在 `view === 'trash'` 時等 `!trashLoading`。
     - `mutate` 支援 `{ includeTrash?: boolean }`：在垃圾桶的寫入成功後，經同一條佇列重抓 `GET /api/tasks/tasks`（含規則與即將到來通知）與 `GET /api/tasks/trash`，不做樂觀更新。
     - 新增 `handleRestore`（`POST /api/tasks/trash/${id}/restore`）、`handlePurge`（`DELETE /api/tasks/trash/${id}`）、`handleEmptyTrash`（`DELETE /api/tasks/trash`）；成功後清掉網址 `task` 參數並由 `mutate` 處理焦點遞補（清空後若焦點掉到 `body` 則移到中欄容器）。
     - 中欄在 `view === 'trash'` 渲染 `TrashList`，右欄渲染 `TrashDetail`（以 `key={selectedTask?.id ?? 'empty'}` 掛載）。
   - （`TaskList.tsx` 因拆分出 `TrashList.tsx`，無需修改。）

6. **文件更新**
   - `docs/tasks/data-model.md`：補上 `task.deletedAt` 欄位、軟刪除與垃圾桶領域規則、重複任務清理差異。
   - `docs/tasks/api.md`：更新 `GET /api/tasks/tasks` 與 `DELETE /api/tasks/tasks/:id` 說明，新增四支 `/api/tasks/trash` 端點。
   - `docs/tasks/ui/layout.md`：補上垃圾桶視圖（中欄／右欄唯讀、清空與永久刪除確認、一般刪除不跳確認）。

### 實作步驟順序

1. 修改 `schema.ts`，執行 `npm run tasks:db:generate` 產生 migration，更新 `db/migrations.test.ts` 的種子。
2. 實作伺服器端：`server/tasks.ts`、`server/trash.ts`、`server/checklist.ts`、`server/reminders.ts`、`server/recurrence.ts`。
3. 跑後端測試驗證 `trash.test.ts`、`notifications.test.ts`、`checklist.test.ts`、`reminders.test.ts`、`recurrence.test.ts`、`tasks.test.ts`、`migrations.test.ts` 全過。
4. 新增 `src/app/api/tasks/trash/` 三支 route handler。
5. 修改 `lib/tasks.ts`、`lib/views.ts`、`lib/errors.ts`，驗證 `lib/views.test.ts` 通過。
6. 實作前端元件：修改 `TaskDetail.tsx`，新增 `TrashList`、`TrashDetail` 與對應 `.module.css`，整合進 `ThreeColumnLayout.tsx`。
7. 更新 `docs/tasks/data-model.md`、`docs/tasks/api.md`、`docs/tasks/ui/layout.md`。
8. 執行 `npx next typegen`、`npx tsc --noEmit`、`npm run lint`、`npm test`，並在沙盒資料（`PERSONAL_TOOLS_DATA_DIR=~/Developer/TT/gemini/personal-tools-data`）跑 `npm run dev` 手動驗證 4 個情境後寫回報並 commit。

### 測試或規格的疑問

1. **`DELETE /api/tasks/trash` 回應形狀**：`emptyTrash()` 回傳刪除筆數（`number`），但 §6h 未指定 HTTP 回應是要回 `200` + `{ deleted: number }` 還是像其他 DELETE 端點回 `204 No Content`。計畫暫定 `200` + `{ deleted: count }`，若偏好 `204` 請告知。
2. **`reminders.ts` 的 `updateReminder`／`deleteReminder`**：卡片只點名 `assertOwnerExists`（涵蓋 `listReminders`、`createReminder`），但 `updateReminder` 與 `deleteReminder` 只以 `reminderId` 查提醒；照 §6h「垃圾桶裡的任務唯讀：編輯、checklist、提醒、轉成重複規則一律回 404」，我計畫也對 `existing.taskId !== null` 加檢查是否在垃圾桶。確認是否同意。
3. **`updateRule` 非排程欄位就地更新**：只改規則標題／描述／優先級／不進摘要／checklist 範本時，`futureIncompleteCondition` 目前沒過濾 `deletedAt`。若某未來實例已被丟進垃圾桶，是否應加上 `isNull(task.deletedAt)` 保持不動（計畫暫定加上）？
4. **`createTask`／`updateTask` 傳入 `deletedAt`**：目前 `editedAt` 由白名單忽略，未在 `collectErrors` 明確拒絕；`deletedAt` 是否比照 `editedAt` 忽略即可，還是要像 `recurrenceRuleId`／`occurrenceDate` 回 `not_allowed`？
5. **垃圾桶右欄不顯示提醒**：因 `reminders.ts` 的 `assertOwnerExists` 把垃圾桶任務視為不存在（只有 `listChecklistItems` 列為例外），右欄 `TrashDetail` 會唯讀顯示 checklist 但不顯示提醒列表。確認這符合設計意圖（若要唯讀顯示提醒，`listReminders` 需另開例外）。
6. **左欄底部順序與「清空垃圾桶」位置**：`VIEWS` 尾端加 `trash` 後沿用 `reminders` 上的 `.bottomView`，會讓 `提醒` 與 `垃圾桶` 一起靠左欄底部（`垃圾桶` 在最底）；「清空垃圾桶」放中欄標題列右側（僅垃圾桶非空時出現）。確認排版 OK。
7. **主線測試確認**：已完整讀過六支測試檔（`trash.test.ts`、`notifications.test.ts`、`checklist.test.ts`、`reminders.test.ts`、`recurrence.test.ts`、`views.test.ts`），規格一致、未發現測試有誤。

### 主線確認(2026-11-28)

計畫通過,可以開始實作。疑問的答覆:

1. `DELETE /api/tasks/trash`:照計畫,`200` + `{ deleted: number }`。
2. 同意:`updateReminder`、`deleteReminder` 對屬於垃圾桶任務的提醒回 `NotFoundError`。
3. 同意:非排程欄位的就地更新不動垃圾桶裡的實例(加 `isNull(task.deletedAt)`)。
4. `deletedAt` 比照 `editedAt`,由白名單忽略,不另外回 `not_allowed`。
5. 同意:右欄不顯示提醒,`listReminders` 不開例外。
6. 排版照計畫。
7. 收到。

另外注意:
- `ThreeColumnLayout` 的「render 期偵測切換進 trash」那段,寫好後在回報的「最可能出錯的地方」說明:為什麼不會在每次 render 都觸發、從垃圾桶切回其他視圖時狀態怎麼收。
- `migrations.test.ts`:新的種子照 0011 的 schema 寫;既有那支 0008 的 `reminder_time` 測試是自己裁 journal 跑的,不要改動它的範圍。

## 回報(Gemini 填寫)
- 做了什麼(每個檔案一行):
- 沒做什麼、為什麼:
- 每個完成條件怎麼驗證的:
- 最可能出錯的地方:
- 疑問:
