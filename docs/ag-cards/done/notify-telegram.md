# 開發任務:平台通知層,Telegram 管道(notify-telegram)

## 0. 準備
`git switch -c gemini/notify-telegram main`(main 要包含 `88ee520`)。worktree 與假資料規則照 `AGENTS.md`。

## 目標
實作 `docs/platform/decisions.md` §8 的發送層:`src/platform/notify/`,提供一個發送函式與 Telegram 管道。這張卡**不做** runner 與任何工具的提醒(第一個使用者是習慣提醒,另一張卡)。

- 設定檔:`<資料夾>/notify/telegram.json`(`{ "botToken", "chatId" }`),位置由 `src/platform/dataDir.ts` 推算。缺檔或缺欄位時丟出平台的錯誤類別(`src/platform/errors.ts` 的基底),訊息寫明檔案路徑,**不印出 token**。
- 發送函式與管道分開(之後會加別的管道);呼叫 Telegram 用 `fetch`,`fetch` 可注入,測試不連網路。
- 一支手動測試用的指令:`npm run notify:test -- "訊息"`,讀設定檔送一則訊息。你的假資料夾沒有真的 token,只要確認缺設定時的錯誤訊息正確;實際送出由使用者測。

## 背景
`CLAUDE.md`、`docs/platform/decisions.md` §1(錯誤類別)、§4(platform 不匯入模組、不放畫面)、§8。

## 可以改的檔案
- 新增:`src/platform/notify/`(程式、測試、手動指令)
- `package.json`(只加 `notify:test` 這個 script)
- `docs/platform/backlog.md`(通知那條標明發送層完成、runner 待做)

## 不能改的檔案
`src/modules/`、`src/app/`、`src/platform/` 既有檔案(新增 `errors.ts` 的子類別若需要,寫在 `notify/` 裡)、`AGENTS.md`、`CLAUDE.md`、`docs/platform/decisions.md`

## 完成條件
- `npx tsc --noEmit`、`npm run lint`、`npm test` 全過;測試涵蓋:送出成功、Telegram 回錯誤、缺設定檔、缺欄位,而且錯誤訊息裡沒有 token。
- 在假資料夾跑 `npm run notify:test -- "hi"`,得到缺設定檔的錯誤,結果寫進回報。
- commit 前綴 `platform:`。

## 回報(Gemini 填寫)
- 做了什麼(每個檔案一行):
  - `src/platform/notify/types.ts`:定義 `NotifyMessage` 與 `NotifyChannel` 介面,將發送介面與管道實作分開。
  - `src/platform/notify/errors.ts`:定義繼承 `ValidationErrorBase` 的 `NotifyConfigError` 與傳送失敗用的 `NotifyDeliveryError`。
  - `src/platform/notify/telegram.ts`:實作 `loadTelegramConfig`（從 `toolDataPath('notify', 'telegram.json')` 讀取並檢查 `botToken` 與 `chatId`,缺檔/缺欄位丟 `NotifyConfigError` 且帶檔案路徑、不印 token）與 `createTelegramChannel`（可注入 `fetch`,失敗與錯誤皆過濾 token）。
  - `src/platform/notify/index.ts`:實作 `formatNotifyMessage` 與 `sendNotification`,預設使用 Telegram 管道,並 re-export 型別、錯誤與管道工廠。
  - `src/platform/notify/test-cli.ts`:實作 `notify:test` 手動測試指令,接收參數訊息並呼叫 `sendNotification`。
  - `src/platform/notify/notify.test.ts`:補上 7 支單元測試（送出成功、Telegram API 錯誤、fetch 失敗、缺設定檔、缺 `chatId`、缺 `botToken`、空訊息,並驗證不洩漏 token）。
  - `package.json`:新增 `"notify:test": "tsx src/platform/notify/test-cli.ts"` script。
  - `docs/platform/backlog.md`:將「通知」項目更新為 Telegram 發送層完成、runner 待做。
- 沒做什麼、為什麼:
  - 未實作 launchd runner 與習慣提醒功能:依任務卡規格,本卡只做 `src/platform/notify/` 發送層與 Telegram 管道。
  - 未實際連線 Telegram API 送出訊息:假資料夾沒有真實 bot token,依規定由使用者自行測試。
- 每個完成條件怎麼驗證的:
  - `npx next typegen`、`npx tsc --noEmit`、`npm run lint`、`npm test`:全部執行通過（525/525 tests pass,含 `platform/notify` 7 支測試）。
  - 在假資料夾執行 `npm run notify:test -- "hi"`:如預期以 exit code 1 結束並輸出 `Telegram config file not found: /Users/shihsiou/Developer/TT/gemini/personal-tools-data/notify/telegram.json`。
- 最可能出錯的地方:
  - `telegram.json` 的 `chatId` 若使用者填成數字（如群組負數 id）或字串,目前 `loadTelegramConfig` 兩者皆接受並轉為字串,但未額外檢查 Telegram Bot API 的其他可選欄位（如 `parse_mode`）。
  - `createTelegramChannel` 若未來需要超時控制（`AbortSignal.timeout`）或重試,目前直接交由 `fetch` 預設行為處理,待 runner 設計重試策略時再補。
- 疑問:
  - 無。
