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

## 回報(Gemini 填寫)
- 做了什麼(每個檔案一行):
- 沒做什麼、為什麼:
- 每個完成條件怎麼驗證的:
- 最可能出錯的地方:
- 疑問:
