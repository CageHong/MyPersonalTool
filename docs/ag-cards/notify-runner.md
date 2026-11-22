# notify-runner:通知 runner(平台層)

> 先擬計畫:讀完程式碼後在「實作計畫」寫出要改的檔案與步驟,commit 後停下,等主線確認才實作。

## 0. 準備
分支 `gemini/notify-runner` 由主線從 main 建好,上面有主線寫的測試與這張卡。直接在這個分支上工作。worktree 與假資料規則照 `AGENTS.md`。

## 目標
實作 `docs/platform/decisions.md` §8「runner(2026-11-22 定案)」那張表:runner 程式、工具通知入口的對照表、launchd 排程。

這是三張卡的第一張,**只做平台層**。tasks 的摘要與習慣提醒(卡 2)、通知設定的畫面(卡 3)都不在這張;做完後對照表是空的,tick 什麼都不送,這是預期的。

## 背景
`CLAUDE.md`(依賴方向)、`docs/platform/decisions.md` §8、§9、§10;發送層 `src/platform/notify/`(已完成,用它的 `sendNotification`);launchd 範本機制 `deploy/macos/`(`install.sh` 會處理資料夾裡所有 `*.plist.template`)。

要點(規則本身以 decisions 為準):
- `src/jobs/notifiers.ts`:型別 `DueNotification`(`{ key: string; message: NotifyMessage }`)、`ToolNotifier`(`dueNotifications(now: Date)`、`markSent(keys: string[])`,兩者都可以是同步或非同步),以及對照表 `NOTIFIERS: Partial<Record<ToolId, ToolNotifier>>`(這張卡是空物件)。
- `key` 對 runner 是不透明字串:由工具自己決定內容(例如把日期編進去),runner 只負責原樣交回 `markSent`。
- `src/jobs/notify.ts`:`runNotifyTick({ now, tools?, notifiers?, send? })`,預設值分別是 `TOOLS`(`src/platform/tools.ts`)、`NOTIFIERS`、`sendNotification`。回傳 `{ sent: { tool, key }[], failed: { tool, stage: 'due' | 'send' | 'markSent', key?, error }[] }`。行為見測試。
- 一支執行一次 tick 的入口(例如 `src/jobs/notify-cli.ts`),把回報印到 stdout/stderr(launchd 的 log)。`package.json` 加 `notify:tick`。
- `deploy/macos/com.personal-tools.notify.plist.template`:`StartInterval` 900(每 15 分鐘)、`RunAtLoad`,不要 `KeepAlive`;環境變數與 log 位置比照 web 那份。log 檔名用 `notify.*.log`。

## 可以改的檔案
- 新增 `src/jobs/notifiers.ts`、`src/jobs/notify.ts`、tick 的入口;要的話可以加自己的測試檔
- 新增 `deploy/macos/com.personal-tools.notify.plist.template`;`deploy/macos/install.sh`、`uninstall.sh` 只在它們處理不了第二份範本時才改
- `package.json`(只加 `notify:tick`)
- `deploy/macos/README.md`(多一個 job)、`docs/platform/backlog.md`(通知那條:runner 完成,tasks 的提醒待做)

## 不能改的檔案
`src/platform/`、`src/modules/`、`src/app/`、`AGENTS.md`、`CLAUDE.md`、`docs/platform/decisions.md`。主線的測試不能改。

## 測試(主線提供)
- `src/jobs/notify.test.ts`:`runNotifyTick` 的所有行為(交出 now、逐則送、只標記成功的、一則失敗不影響其他、工具丟錯不影響其他工具、略過沒有入口的工具、同步與非同步)

測試就是規格。覺得測試有錯就停下,寫進回報。

## 完成條件
- `npx next typegen` 後 `npx tsc --noEmit`、`npm run lint`、`npm test` 全過
- 在沙盒資料夾跑 `npm run notify:tick`:對照表為空,正常結束、回報 0 則,結果寫進回報
- `npm run deploy:install -- --dry-run` 顯示兩份 plist(web、notify)會怎麼安裝,輸出寫進回報。**不要**真的安裝,launchd 由使用者自己裝
- commit 前綴 `platform:`

## 疑問(主線已知,計畫裡請回應)
- runner 由 launchd 直接執行 repo 裡的原始碼,不像網頁跑的是 deploy 時 build 出來的版本;所以 repo 切到別的分支時,runner 跑的也是那個分支的程式。請在計畫裡說明你的做法會怎麼處理這點(可以是「接受,寫進 README」)。

## 實作計畫(Gemini 先填,等主線確認)

### 要新增／修改的檔案
1. **新增 `src/jobs/notifiers.ts`**
   - 定義 `DueNotification`（`{ key: string; message: NotifyMessage }`）與 `ToolNotifier`（`dueNotifications(now: Date)`、`markSent(keys: string[])`，兩者皆支援同步或非同步回傳）。
   - 匯出 `NOTIFIERS: Partial<Record<ToolId, ToolNotifier>> = {}`（本卡維持空物件，待後續卡片接上各工具）。
2. **新增 `src/jobs/notify.ts`**
   - 實作 `runNotifyTick({ now?, tools?, notifiers?, send? })`，預設值依序為 `new Date()`、`TOOLS`（`../platform/tools`）、`NOTIFIERS`（`./notifiers`）、`sendNotification`（`../platform/notify`）。
   - 依序遍歷 `tools`：
     - 若 `notifiers[tool.id]` 不存在則略過；不在 `tools` 裡的 `notifiers` key 也不處理。
     - 呼叫 `await notifier.dueNotifications(now)`；若丟錯，將 `{ tool: tool.id, stage: 'due', error }` 記進 `failed` 並繼續下一個工具。
     - 若無到期通知，不呼叫 `send` 也不呼叫 `markSent`。
     - 對每則到期通知逐則呼叫 `await send(item.message)`：成功者記進 `sent` 與 `succeededKeys`，失敗者將 `{ tool: tool.id, stage: 'send', key: item.key, error }` 記進 `failed`，不影響其他則。
     - 若 `succeededKeys.length > 0`，呼叫 `await notifier.markSent(succeededKeys)`；若丟錯，將 `{ tool: tool.id, stage: 'markSent', error }` 記進 `failed`，不影響其他工具。
   - 回傳 `{ sent, failed }`。
3. **新增 `src/jobs/notify-cli.ts`**
   - 執行 `runNotifyTick({ now: new Date() })`，將本次 tick 的時間戳與 `{ sent, failed }` 摘要印到 `stdout`；若有 `failed` 項目則把失敗明細印到 `stderr` 並設定 `process.exitCode = 1`。
4. **修改 `package.json`**
   - 在 `scripts` 新增 `"notify:tick": "tsx src/jobs/notify-cli.ts"`。
5. **新增 `deploy/macos/com.personal-tools.notify.plist.template`**
   - `Label` 為 `com.personal-tools.notify`。
   - `ProgramArguments` 比照 web 範本以 `__NODE_BIN__` 直接執行 `__REPO_DIR__/node_modules/tsx/dist/cli.mjs` 與 `__REPO_DIR__/src/jobs/notify-cli.ts`。
   - `WorkingDirectory` 為 `__REPO_DIR__`；`EnvironmentVariables` 設 `NODE_ENV=production`、`PERSONAL_TOOLS_DATA_DIR=__DATA_DIR__`、`PATH=__NODE_DIR__:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`。
   - 設 `StartInterval` 為 `300`、`RunAtLoad` 為 `<true/>`，不設 `KeepAlive`。
   - `StandardOutPath` 與 `StandardErrorPath` 設為 `__LOG_DIR__/notify.stdout.log` 與 `__LOG_DIR__/notify.stderr.log`。
   - 經檢查 `deploy/macos/install.sh` 與 `uninstall.sh` 已會掃描所有 `*.plist.template` 並支援 `--job`，兩支腳本不需修改。
6. **修改 `deploy/macos/README.md` 與 `docs/platform/backlog.md`**
   - `deploy/macos/README.md`：補上 `com.personal-tools.notify` 的說明（每 5 分鐘執行、`notify.*.log` 位置、手動啟停指令、`--job` 用法，以及直接執行 repo 原始碼的分支注意事項）。
   - `docs/platform/backlog.md`：更新「通知」那條，標明 launchd runner 已完成、tasks 的提醒待做。

### 驗證步驟
1. 執行 `npx next typegen`、`npx tsc --noEmit`、`npm run lint`、`npm test`（確認 `src/jobs/notify.test.ts` 與既有測試全過）。
2. 在暫存沙盒資料夾（`PERSONAL_TOOLS_DATA_DIR=/tmp/...`）執行 `npm run notify:tick`，確認對照表為空時正常結束、回報 0 則。
3. 執行 `npm run deploy:install -- --dry-run`，確認同時列出 `com.personal-tools.web.plist` 與 `com.personal-tools.notify.plist` 的渲染結果與指令。

### 回應「疑問」
- **分支切換會影響 runner 執行的程式**：接受這個設計，並明確寫進 `deploy/macos/README.md`。平常開發都在獨立 worktree 進行、主 repo 維持在 `main`，因此實際上很少受影響；在 `README.md` 提醒若在安裝時指定的 repo 目錄切換分支，下一次 5 分鐘 tick 就會跑該分支的程式（需要時可先用 `launchctl bootout` 暫停）。

### 主線確認(2026-11-22)
計畫通過,照做,只改下面兩點:
1. **間隔改成每 15 分鐘**:`StartInterval` 用 `900`,不是 `300`(`docs/platform/decisions.md` §8 已更新);README 也寫 15 分鐘。
2. **沙盒用 `gemini/personal-tools-data/`**,不要另開 `/tmp/...`(`AGENTS.md`)。

分支問題照你的回應:接受,寫進 README(§8 已記為決策)。`runNotifyTick` 的 `now` 可以選填,沒問題。

## 回報(Gemini 填寫)
- 做了什麼(每個檔案一行):
- 沒做什麼、為什麼:
- 每個完成條件怎麼驗證的:
- 最可能出錯的地方:
- 疑問:
