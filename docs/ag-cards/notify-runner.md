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
- `deploy/macos/com.personal-tools.notify.plist.template`:`StartInterval` 300、`RunAtLoad`,不要 `KeepAlive`;環境變數與 log 位置比照 web 那份。log 檔名用 `notify.*.log`。

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

## 回報(Gemini 填寫)
- 做了什麼(每個檔案一行):
- 沒做什麼、為什麼:
- 每個完成條件怎麼驗證的:
- 最可能出錯的地方:
- 疑問:
