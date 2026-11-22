# recurring-skip:重複任務錯過就跳過

## 0. 準備
分支 `gemini/recurring-skip` 已由主線從 main 建好,上面有主線寫的測試(見「測試」)。直接在這個分支上工作。worktree 與假資料規則照 `AGENTS.md`。

## 目標
實作 `docs/tasks/decisions.md` §6a 最新的三列(「錯過就跳過」、「編輯過」的定義、既有實例的推斷)與「建立規則時不回溯」那列的新理由(原任務算編輯過)。

## 背景
`CLAUDE.md`、`.claude/rules/tasks.md`、`docs/tasks/data-model.md`(重複任務的補齊)、`docs/tasks/decisions.md` §6、§6a。

要點(規則本身以 decisions 為準):
- `task` 加可空欄位 `editedAt`(`edited_at`,unix 秒)。任何真的改到資料的寫入都設成現在時間:`updateTask`(patch 沒有改變任何欄位時不寫,也不設)、checklist 的新增、修改、刪除、排序。補齊產生實例時是 null;`createRuleFromTask` 把原任務設成轉換的時間。
- 跳過在 `fillRule`(`server/recurrence.ts`)做:先刪掉這條規則「未完成、`occurrenceDate` 與 `dueDate` 都早於今天、`editedAt` 為 null」的實例(checklist 一起),再補齊;補齊的起點不早於今天。水位線已經超過終點、這次不產生新日期時也要刪。已停止的規則不補齊,也不跳過(`fillInstances` 本來就只處理進行中的規則)。
- **上線不能自動刪既有資料。** 用 `drizzle-kit generate --custom`(加 `--config src/modules/tasks/drizzle.config.ts`)另產生一個空的 migration,在裡面寫:既有的重複實例中,未完成、`occurrence_date` 早於或等於本地今天的,`edited_at` 設成 `0`。`0` 的意思是「上線前就存在,是否編輯過未知」;跳過只看 null,所以這些先全部保留。
- 既有實例的清理是一支腳本 `src/modules/tasks/tools/skip-legacy-missed.ts`(`npm run tasks:skip-legacy-missed`):找出 `edited_at = 0`、進行中的規則、未完成、`occurrenceDate` 與 `dueDate` 都早於今天的實例,用 `server/missedInstances.ts` 的 `looksEdited` 判斷;沒編輯過的列出來(id、規則標題、日期)。預設只列出不寫入;`--apply` 才在一個 transaction 裡刪除。推斷為編輯過的維持 `0`,不動。
- 「+N 逾期」不改,它自然只會算到保留下來的實例。

## 可以改的檔案
- `src/modules/tasks/db/schema.ts`、`npm run tasks:db:generate` 與 `--custom` 產生的 migration(例外:`--custom` 產生的空 migration 要自己寫 SQL,這是本卡明確允許的;snapshot、journal 照規則不手改)、`src/modules/tasks/db/migrations.test.ts` 的種子
- `src/modules/tasks/server/tasks.ts`、`checklist.ts`、`recurrence.ts`、`missedInstances.ts`
- 新增 `src/modules/tasks/tools/skip-legacy-missed.ts`;`package.json` 加 `tasks:skip-legacy-missed`
- `docs/tasks/data-model.md`(補齊規則、`editedAt`、`0` 的意思)、`docs/tasks/api.md`(回應多了 `editedAt` 的話)、`docs/tasks/ui/recurrence.md`(提到逾期實例的地方)
- 新增測試可以;腳本的邏輯建議抽成可測的函式

## 不能改的檔案
`docs/tasks/decisions.md`、`AGENTS.md`、`CLAUDE.md`、`src/platform/`、`src/app/`、前端元件。主線的測試(下節)不能改。

## 測試(主線提供)
- `src/modules/tasks/server/recurrence.test.ts`:新的 `skipping missed instances` 區塊;既有的 `fillInstances`、`updateRule`、`stopRule`、`until` 測試已依新規則改寫(`setupRuleWithHistory` 的情境也改了)
- `src/modules/tasks/server/tasks.test.ts`:`editedAt` 的寫入時機
- `src/modules/tasks/server/missedInstances.test.ts`:`looksEdited`
- 測試用 SQL 讀 `edited_at`(欄位還沒有時在執行期失敗);加了欄位後可以不改它們

測試就是規格。覺得測試有錯就停下,寫進回報。

## 完成條件
- `npx next typegen` 後 `npx tsc --noEmit`、`npm run lint`、`npm test` 全過(含 `db/migrations.test.ts`)
- 在沙盒資料(`gemini/personal-tools-data/`)上手動驗證並寫進回報:
  1. 套 migration 前先造一條每天的規則與幾天前的實例(有一筆寫了描述),套 migration 後確認它們的 `edited_at` 是 0、今天之後的是 null
  2. `npm run tasks:skip-legacy-missed` 只列出沒編輯過的,資料不變。`--apply` 依 `AGENTS.md` 不要執行(沙盒也不要);刪除的行為用測試驗證(記憶體資料庫:只刪列出的那些,寫了描述的還在)
  3. `npm run dev` 開任務清單:舊逾期(`edited_at = 0`)仍在;另造一筆上線後才錯過、沒動過的實例,重新整理後不見了
- **不要**對正式資料(`personal-tools-data/`)執行任何指令
- commit 前綴 `tasks:`

## 回報(Gemini 填寫)
- 做了什麼(每個檔案一行):
  - `src/modules/tasks/db/schema.ts`:在 `task` 表新增可空欄位 `editedAt`(`edited_at`,Unix 秒)。
  - `src/modules/tasks/drizzle/0006_typical_switch.sql`、`meta/*`:由 `npm run tasks:db:generate` 產生新增 `edited_at` 欄位的 migration。
  - `src/modules/tasks/drizzle/0007_sad_vindicator.sql`、`meta/*`:由 `drizzle-kit generate --custom` 產生並填入 SQL,將既有未完成且 `occurrence_date <= date('now', 'localtime')` 的重複實例 `edited_at` 設成 `0`。
  - `src/modules/tasks/db/migrations.test.ts`:於 `SEED` 補上 `task_list_view` 種子資料。
  - `src/modules/tasks/server/tasks.ts`:`updateTask` 僅在實際有欄位改變寫入時將 `editedAt` 設為當下時間。
  - `src/modules/tasks/server/checklist.ts`:checklist 項目的新增(單筆與批次)、修改(實際有變化時)、刪除、排序都在同一個 transaction 裡將所屬任務的 `editedAt` 設為當下時間。
  - `src/modules/tasks/server/recurrence.ts`:`fillRule` 先刪除該規則未完成、`occurrenceDate` 與 `dueDate` 都早於今天且 `editedAt` 為 `null` 的實例,再從不早於今天的日期補齊(水位線超過終點時仍會先刪除),新產生實例 `editedAt` 為 `null`;`createRuleFromTask` 將原任務 `editedAt` 設為轉換時間。
  - `src/modules/tasks/server/missedInstances.ts`:實作純函式 `looksEdited`。
  - `src/modules/tasks/tools/skip-legacy-missed.ts` 與 `skip-legacy-missed.test.ts`:實作並測試 `skipLegacyMissedInstances` 與 CLI 腳本(預設只列出,`--apply` 才在 transaction 裡刪除)。
  - `package.json`:新增 `tasks:skip-legacy-missed` script。
  - `docs/tasks/data-model.md`、`docs/tasks/api.md`、`docs/tasks/ui/recurrence.md`:補上 `editedAt`、`0` 的語意與「錯過就跳過」補齊規則說明。
- 沒做什麼、為什麼:
  - 未對沙盒或正式資料執行 `--apply`(依任務卡與 `AGENTS.md` 規則);`--apply` 刪除行為已於記憶體資料庫單元測試驗證。
  - 未修改主線測試(`recurrence.test.ts`、`tasks.test.ts`、`missedInstances.test.ts`)與任何前端元件。
- 每個完成條件怎麼驗證的:
  - **`npx next typegen`、`npx tsc --noEmit`、`npm run lint`、`npm test`**:全數通過(`npm test` 72 suites / 576 tests 全過,包含 `db/migrations.test.ts`、`tasks.test.ts`、`recurrence.test.ts`、`missedInstances.test.ts`、`skip-legacy-missed.test.ts`)。
  - **沙盒資料手動驗證(`gemini/personal-tools-data/tasks/tasks.db`)**:
    1. 套 migration 前建立每日規則 `Sandbox Daily Walk` 與 `2026-11-19..2026-11-23` 實例(`2026-11-20` 寫入描述),執行 `npm run tasks:db:migrate` 後驗證 `2026-11-19..2026-11-22` 的 `edited_at` 為 `0`、`2026-11-23` 為 `null`。
    2. 執行 `npm run tasks:skip-legacy-missed`(未加 `--apply`),只列出 `#1 (2026-11-19)` 與 `#3 (2026-11-21)`,寫了描述的 `#2 (2026-11-20)` 與今天的 `#4` 未列出,且 DB 筆數維持 5 筆不變。
    3. 另於沙盒 DB 插入 `2026-11-18` 且 `edited_at = NULL` 的實例(`id=6`),啟動 `npm run dev` 開啟 `/tasks` 並重整:畫面顯示 `Sandbox Daily Walk` 截止日 `11.19`、`+2 逾期`(即 `11.19`、`11.20`、`11.21` 三筆 `edited_at = 0` 舊逾期都在);查 DB 確認 `id=6`(`2026-11-18`)已被自動刪除,`id=1..5` 保留且補齊 `2026-11-24..2026-11-28`(`edited_at = null`)。
- 最可能出錯的地方:
  - `0007_sad_vindicator.sql` 使用 SQLite 的 `date('now', 'localtime')` 判定本地今天,與伺服器運行 `todayIso()` 一致;若執行 `tasks:db:migrate` 時的系統時區與平常不同,當天的實例可能被多標或少標 `0`。
  - `skip-legacy-missed.ts` 依 `task.editedAt = 0` 與 `isNull(taskRecurrenceRule.endedAt)` 篩選,執行 `--apply` 前務必先不帶 `--apply` 確認清單與備份資料庫。
- 疑問:
  - 無。
