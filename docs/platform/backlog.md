# 平台 Backlog

平台層級還沒定或還沒做的事。各工具的在 `docs/<工具>/backlog.md`。

## 待決

- 工具切換頂列的高度(§7)

## 待做

- **常駐運行**(§9):完成(2026-11-22),正式版在 `localhost:3100`。通知 runner 已用同一套範本機制加成第二個 job(`com.personal-tools.notify`,2026-11-22 安裝)。兩個 job 改從各自的啟動腳本(`deploy/macos/bin/`)啟動,修掉每 15 分鐘跳一次「背景項目:node」通知(2026-11-22,§9)。
- **手機存取**(§9):`tailscale serve`。要做,不急。
- **通知**(`docs/platform/decisions.md` §8):`src/platform/notify/`(Telegram 發送層)與 `src/jobs/notify.ts` + `com.personal-tools.notify` launchd runner 完成;tasks 的摘要與個別提醒後端完成(2026-11-22),UI 見 tasks backlog。新 bot 已開、`notify/telegram.json` 已放好(2026-11-22)。
- **工具切換頂列**(`docs/platform/decisions.md` §7):第一階段完成(頂列、九宮格面板、`src/platform/tools.ts`、首頁入口改讀它、回到上次網址)。狀態列等摘要 API。待決:頂列高度。
- **首頁**(`docs/platform/decisions.md` §4):第一段(只有工具入口)完成;第二段待做,在 finance 的報表(`reports` 模組)做好後加摘要小工具,由各工具提供小工具元件與摘要 API。
- **新套件要加進 `transpilePackages`**:`packages/` 的套件直接匯出 TypeScript 原始碼。Next.js 的程式(頁面、route handler、它們匯入的模組)第一次匯入某個套件時,把套件名稱加進 `next.config.ts` 的 `transpilePackages`(目前有 `statement-parsers`)。
- **本地日期與時刻共用一份**(2026-11-22 記,小卡交 AG):「現在的本地日期／時刻」有四份實作:tasks `lib/date.ts` 的 `todayIso()`(不收參數、讀時鐘)、finance `lib/date.ts` 的 `localToday(now)`(經 `toISOString` 再轉本地)、tasks `server/notifications.ts` 與 `server/reminders.ts` 各一份相同的 `toLocalDateAndTime`。模組之間不能互相匯入,所以放 `src/platform/`(例如 `localDate(now)`、`localTime(now)`),四處改用;`now` 由參數傳入,方便測試。
- **金額十進位統一**(2026-11-22 記,回頭點:`receipt-fetch/` 搬進 repo 時):`packages/statement-parsers/src/decimal.ts` 是字串、小數位數不限、標準化去尾零(`1.40` → `1.4`);`packages/receipt-parsers/src/decimal.ts` 用 bigint 分、固定 2 位(`1.4` → `1.40`)、超過 2 位回 `null`。收據與對帳單對帳時,字串比對會把同一金額當成不同,`amountsEqual` 遇到超過 2 位的對帳單金額(例如換匯)一律不等。方向:新增共用的金額套件,兩個 parser 改用;精度規則見 finance 的紀錄(待決)。

## 明確不做(提出前先問)

使用者帳號、深色模式。(「部署設定」2026-11-22 移出:改成 §9 的本機常駐運行;多人與換機器仍不做,見 §10。)

## 之後要做,但不要主動提

- **共用設計系統**:要做(接近 Apple 的設計美學,各工具同一套樣式、各自的主題色),由使用者自己開 session 處理。做其他事時不要主動提議、不要順手抽元件或改樣式。
