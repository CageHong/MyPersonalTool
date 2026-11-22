# platform-local-date:本地日期與時刻共用一份

> 不改行為的重構,範圍明確:不必先擬計畫,直接實作。過程中發現要改變行為,停下寫進回報。

## 0. 準備
分支 `gemini/platform-local-date` 由主線從 main 建好。worktree 與假資料規則照 `AGENTS.md`。

## 目標
`docs/platform/backlog.md`「本地日期與時刻共用一份」:把四份「現在的本地日期／時刻」換成 `src/platform/` 的一份。

## 背景
現在的四份(行為相同,都是執行環境時區的本地日期):
- tasks `src/modules/tasks/lib/date.ts` 的 `todayIso()`(不收參數)
- finance `src/modules/finance/lib/date.ts` 的 `localToday(now = new Date())`(經 `toISOString` 再由 `formatLocalDate` 轉回本地,結果相同)
- tasks `src/modules/tasks/server/notifications.ts` 與 `server/reminders.ts` 各一份 `toLocalDateAndTime(now)`

模組之間不能互相匯入,共用的放 `src/platform/`(根目錄 `CLAUDE.md`「依賴方向」)。前端元件也會用到,所以新檔只能是純函式,不碰 Node 的 API。

## 做法
- 新增 `src/platform/date.ts`:`localDate(now: Date): string`(`YYYY-MM-DD`)、`localTime(now: Date): string`(`HH:MM`)。`now` 一律由參數傳入,不給預設值,讀時鐘的是呼叫端。
- 新增 `src/platform/date.test.ts`:月、日補零;跨午夜(23:59 與 00:00);`localTime` 補零。
- 四處改用:
  - `todayIso()` 與 `localToday()`:**刪掉**,呼叫端改成 `localDate(new Date())`(或呼叫端原本就有的 `now`)。不要留轉手的包裝函式。
  - 兩份 `toLocalDateAndTime`:刪掉,改用 `localDate(now)` / `localTime(now)`。
- 其他日期計算(`addDays`、`diffDays`、`formatIso`、`presetRange`、`formatLocalDate` 等)不動。

## 可以改的檔案
- 新增 `src/platform/date.ts`、`src/platform/date.test.ts`
- `src/modules/tasks/lib/date.ts`、`src/modules/finance/lib/date.ts`(只刪 `todayIso` / `localToday`)
- 用到這四個函式的檔案(`grep -rn "todayIso\|localToday\|toLocalDateAndTime" src`),只改呼叫與 import
- 既有測試只有在 import 了被刪掉的函式時,才可以改那一行 import 與呼叫,斷言不能改
- `docs/platform/backlog.md`(那一條標完成)

## 不能改的檔案
`src/platform/` 裡 `date.ts` 以外的檔案、`src/jobs/`、schema 與 migration、`AGENTS.md`、`CLAUDE.md`、`docs/*/decisions.md`。

## 完成條件
- `npx next typegen` 後 `npx tsc --noEmit`、`npm run lint`、`npm test` 全過
- `grep -rn "todayIso\|localToday\|toLocalDateAndTime" src` 沒有結果,貼進回報
- commit 前綴 `platform:`

## 回報(Gemini 填寫)
- 做了什麼(每個檔案一行):
  - `src/platform/date.ts`:新增純函式 `localDate(now: Date): string` 與 `localTime(now: Date): string`,格式化執行環境本地日期與時刻。
  - `src/platform/date.test.ts`:新增單元測試,涵蓋月日補零、跨午夜(23:59 / 00:00)與 `localTime` 補零。
  - `src/modules/tasks/lib/date.ts`:刪除 `todayIso()`,將 `isOverdue`、`formatListDay`、`formatListDate`、`formatShortDate` 預設參數改為 `localDate(new Date())`。
  - `src/modules/finance/lib/date.ts`:刪除 `localToday()`。
  - `src/modules/tasks/lib/useToday.ts`:將 `todayIso` 改為 `localDate(new Date())`。
  - `src/modules/tasks/server/tasks.ts`:將 `todayIso()` 改為 `localDate(new Date())`。
  - `src/modules/tasks/server/notifications.ts`:刪除 `toLocalDateAndTime` 與未使用的 `formatIso` 匯入,改用 `localDate(now)` 與 `localTime(now)`。
  - `src/modules/tasks/server/reminders.ts`:刪除 `toLocalDateAndTime` 與未使用的 `formatIso` 匯入,改用 `localDate(now)` 與 `localTime(now)`。
  - `src/modules/tasks/tools/skip-legacy-missed.ts`:將 `todayIso()` 改為 `localDate(new Date())`。
  - `src/app/api/tasks/tasks/[id]/recurrence/route.ts`、`src/app/api/tasks/recurrence-rules/[ruleId]/stop/route.ts`、`src/app/api/tasks/recurrence-rules/[ruleId]/route.ts`、`src/app/api/tasks/habits/route.ts`、`src/app/api/tasks/habits/[habitId]/pause/route.ts`、`src/app/api/tasks/habits/[habitId]/resume/route.ts`、`src/app/api/tasks/habits/[habitId]/logs/route.ts`、`src/app/api/tasks/habits/[habitId]/route.ts`:將 `todayIso()` 改為 `localDate(new Date())`。
  - `src/modules/finance/components/TransactionFilters.tsx`、`src/modules/finance/components/NewTransactionDialog.tsx`、`src/modules/finance/components/ReportPeriod.tsx`、`src/modules/finance/components/OverviewPage.tsx`:將 `localToday()` 改為 `localDate(new Date())`。
  - `docs/platform/backlog.md`:將「本地日期與時刻共用一份」標記為完成。
- 沒做什麼、為什麼:
  - 未更動 `src/modules/tasks/lib/date.ts` 內的 `fromDate` 私有函式與其他日期計算函式(`addDays`、`diffDays`、`formatIso`、`presetRange`、`formatLocalDate` 等),依任務卡指示維持原樣。
  - 未碰觸 `docs/handoff/`(原先即存在的未追蹤資料夾)。
- 每個完成條件怎麼驗證的:
  - `npx next typegen`:執行通過(`Types generated successfully`)。
  - `npx tsc --noEmit`:執行通過(exit code 0,無錯誤)。
  - `npm run lint`:執行通過(exit code 0,無錯誤或警告)。
  - `npm test`:執行通過(89 suites,661 tests 全數 pass,0 fail / 0 skipped)。
  - `grep -rn "todayIso\|localToday\|toLocalDateAndTime" src`:無任何符合項目(exit code 1,輸出為空)。
- 最可能出錯的地方:
  - `src/modules/tasks/lib/useToday.ts` 原本寫 `useState(todayIso)`(傳入函式作為 lazy initializer),改寫為 `useState(() => localDate(new Date()))`,維持僅在初始 mount 時計算一次的行為;若誤寫成 `useState(localDate(new Date()))` 會在每次 render 重新呼叫。
- 疑問:
  - 無。
