# macOS 常駐運行與部署

本資料夾管理 personal-tools 在 macOS 上透過 `launchd`（LaunchAgent）常駐運行正式版的設定與腳本。

- 正式版跑在 `http://localhost:3100`，建置輸出在 `.next-prod/`，由 `launchd` 管理（登入自動啟動、當掉自動重開）。
- 開發版照常使用 `npm run dev`（`http://localhost:3000`，使用預設 `.next/`），兩者可同時運行不互相覆寫。
- 通知 runner（`com.personal-tools.notify`）為獨立 job，透過 `StartCalendarInterval` 每 15 分鐘（每小時 `:00`、`:15`、`:30`、`:45`）與登入時（`RunAtLoad`）執行一次 `src/jobs/notify-cli.ts`，Mac 睡眠期間錯過的話會在醒來時補跑一次。

> **啟動腳本**：plist 的 `ProgramArguments` 不直接寫 `node`，而是 `deploy/macos/bin/web-start` 與 `bin/notify-tick`；腳本用 plist 帶入的 `NODE_BIN` 去 `exec` node。原因是 macOS 的背景項目管理（BTM）用第一個執行檔辨識背景項目，兩個 job 共用同一個 `node` 時，notify 每次執行都會跳「已加入背景項目」通知（`docs/platform/decisions.md` §9）。

> **注意（notify 直接執行原始碼）**：`com.personal-tools.notify` 由 `launchd` 直接以 `tsx` 執行安裝時指定的 repo 目錄裡的原始碼，不像網頁跑 `.next-prod/` 建置結果。若在該 repo 目錄切換到其他分支，下一次排程就會執行該分支的程式（平常建議在獨立 worktree 開發，或先以 `launchctl bootout` 暫停 notify）。

## 安裝

在 repo 根目錄（使用你平常執行 `node` 的終端機環境，例如已載入 nvm 或 Homebrew PATH）：

```bash
npm run deploy:install
```

這會依目前機器推算 `node` 絕對路徑、repo 位置、`PERSONAL_TOOLS_DATA_DIR`（未設定時預設為 repo 旁邊的 `personal-tools-data/`），產生 `~/Library/LaunchAgents/com.personal-tools.web.plist` 與 `~/Library/LaunchAgents/com.personal-tools.notify.plist` 並載入啟動。

- 若只安裝單一 job，可加上 `--job web` 或 `--job notify`。
- 若要先預覽產生的 plist 與指令而不實際安裝：
  ```bash
  npm run deploy:install -- --dry-run
  ```
- 若要自訂資料夾位置，安裝時帶入環境變數即可（之後 `deploy` 會直接從已安裝的 plist 讀取同一份設定）：
  ```bash
  PERSONAL_TOOLS_DATA_DIR=/path/to/data npm run deploy:install
  ```
- 第一次安裝前若尚未建置過 `.next-prod/`，請接著執行一次 `npm run deploy`。

## 更新（Deploy）

在 `main` 分支且工作區乾淨的狀態下執行：

```bash
npm run deploy
```

步驟依序為：
1. 確認在 `main` 且工作區乾淨
2. 執行 `npm test`
3. 停止正式版服務
4. 套用 `tasks` 與 `finance` 的資料庫 migration（讀取 plist 內的 `PERSONAL_TOOLS_DATA_DIR`）
5. 以 `NODE_ENV=production` 與 plist 內的 `NEXT_DIST_DIR`（`.next-prod`）執行 `npm run build`
6. 重新啟動正式版服務

若第 1、2 步失敗，正式版會保持原狀繼續運行；若第 4、5 步失敗，正式版會維持停止並印出失敗步驟，修正後重新執行 `npm run deploy` 即可。

## 查看 Log

Log 預設寫在：

- `~/Library/Logs/personal-tools/web.stdout.log`
- `~/Library/Logs/personal-tools/web.stderr.log`
- `~/Library/Logs/personal-tools/notify.stdout.log`
- `~/Library/Logs/personal-tools/notify.stderr.log`

可用 `tail -f ~/Library/Logs/personal-tools/*.log` 即時查看。

## 出事時手動停止／重啟

```bash
# 手動停止（web 不會因 KeepAlive 立刻重啟；notify 停止排程）
launchctl bootout "gui/$(id -u)/com.personal-tools.web"
launchctl bootout "gui/$(id -u)/com.personal-tools.notify"

# 手動啟動
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.personal-tools.web.plist"
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.personal-tools.notify.plist"
```

## 換 App 圖示

1. 準備一張 PNG,正方形、至少 180×180(建議 512×512 以上)
2. 存成 `personal-tools-data/platform/icon.png`(用 Finder 拖進去覆蓋即可;只認這個檔名,其他檔案會被忽略,備用的圖可以放在旁邊)
3. 不用重新 deploy。瀏覽器分頁重新整理就會換;Dock 上的 App 要從 Dock 移除、把 `~/Applications` 裡的舊 App 丟到垃圾桶,再用 Safari 打開 `http://localhost:3100` →「檔案」→「加入 Dock」

圖不符合規範時會改用預設圖示,原因寫在 `~/Library/Logs/personal-tools/web.stderr.log`(搜尋 `[icon]`)。

## 移除

```bash
npm run deploy:uninstall
```

會卸載 LaunchAgent 並刪除 `~/Library/LaunchAgents/com.personal-tools.web.plist` 與 `com.personal-tools.notify.plist`（可用 `-- --job web` 或 `-- --job notify` 只移除單一 job，不會刪除資料庫或 log）。

## 換 Node 版本之後

已安裝的 plist 裡寫死了 `node` 執行檔的絕對路徑，且 `better-sqlite3` 是原生 C++ 模組（綁定 Node ABI 版本）。更換或升級 Node 版本後，請在新的 Node 環境下依序執行：

```bash
npm rebuild better-sqlite3
npm run deploy:install
```
