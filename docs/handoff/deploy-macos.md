# 開發任務:Mac 上常駐運行與一鍵 deploy(deploy-macos)

**先擬計畫**:讀完程式碼後在「實作計畫」寫出要改的檔案與步驟,commit 後停下,等主線確認才實作。

## 0. 準備
`git switch -c gemini/deploy-macos main`(main 要包含這張卡的 commit)。worktree 與假資料規則照 `AGENTS.md`。

## 目標
實作 `docs/platform/decisions.md` §9 的第 1、2、3、5、8 條:launchd 跑正式版、`npm run deploy`、正式版另一個建置輸出資料夾、SQLite 開 WAL、檔案放 `deploy/macos/`。

這張卡**不做**:通知 runner(§9 第 4 條,另一張卡)、「加入 Dock」(使用者自己做)、手機存取、§10 的任何東西。但安裝方式要能讓 runner 之後用同一套機制加第二個 launchd job。

- **不要真的安裝 launchd job,也不要執行 `launchctl`**。安裝與實際 deploy 由使用者在主 repo 做。腳本要提供 `--dry-run`,印出產生的 plist 與會執行的指令,不實際執行。
- 遵守 §10 的第一條:plist 裡的路徑(repo 位置、node 執行檔、`PERSONAL_TOOLS_DATA_DIR`、log 位置)不寫死在 repo,由安裝腳本在使用者的機器上推算或讀環境變數,再從範本產生。
- launchd 的 PATH 很短,找不到 nvm 或 Homebrew 裝的 node。安裝時要記下 node 的絕對路徑。
- 正式版 port 3100;建置輸出資料夾用環境變數切換(開發版維持預設)。
- deploy 步驟照 §9 第 2 條;任何一步失敗就停下,錯誤訊息要寫明停在哪一步,正式版維持停止還是保持原狀要在計畫裡說明。

## 背景
`CLAUDE.md`、`AGENTS.md`、`docs/platform/decisions.md` §9、§10(「現在就要守的規則」第一條)、`src/platform/dataDir.ts`、Next.js 文件中 `distDir` 與 `next start` 的部分(`node_modules/next/dist/docs/`)。

## 可以改的檔案
- 新增:`deploy/macos/`(plist 範本、安裝／移除腳本、deploy 腳本、給使用者看的 `README.md`:安裝、移除、更新、看 log、出事時怎麼停)
- `next.config.ts`(只加建置輸出資料夾的切換)
- `package.json`(只加 `deploy`、`deploy:install`、`deploy:uninstall` 這類 script)
- `.gitignore`(加正式版的輸出資料夾)
- `src/modules/tasks/db/index.ts`、`src/modules/finance/db/index.ts`:**只加**開 WAL 的 pragma 那一行(與註解),其他不動
- `docs/platform/backlog.md`(常駐運行那條標明完成到哪)

## 不能改的檔案
`src/` 其他所有檔案、`AGENTS.md`、`CLAUDE.md`、`docs/platform/decisions.md`

## 完成條件
- `npx next typegen` 後,`npx tsc --noEmit`、`npm run lint`、`npm test` 全過。
- 安裝腳本 `--dry-run` 的輸出(產生的 plist 全文)貼進回報;輸出裡沒有寫死的使用者路徑出現在 repo 檔案中(用 `grep -rn "/Users/" deploy/` 驗證,結果貼進回報)。
- 在 worktree 用假資料手動驗證:以正式版的輸出資料夾 build,`next start` 在 3100 開得起來、首頁回 200,同時 `npm run dev` 在 3000 也能跑;驗證完兩個都關掉。步驟與結果寫進回報。
- 腳本若有 `shellcheck` 可用就跑,結果寫進回報。
- commit 前綴 `platform:`。

## 實作計畫(Gemini 先填,等主線確認)

## 回報(Gemini 填寫)
- 做了什麼(每個檔案一行):
- 沒做什麼、為什麼:
- 每個完成條件怎麼驗證的:
- 最可能出錯的地方:
- 疑問:
