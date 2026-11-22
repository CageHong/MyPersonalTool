# macOS 常駐運行與部署

本資料夾管理 personal-tools 在 macOS 上透過 `launchd`（LaunchAgent）常駐運行正式版的設定與腳本。

- 正式版跑在 `http://localhost:3100`，建置輸出在 `.next-prod/`，由 `launchd` 管理（登入自動啟動、當掉自動重開）。
- 開發版照常使用 `npm run dev`（`http://localhost:3000`，使用預設 `.next/`），兩者可同時運行不互相覆寫。

## 安裝

在 repo 根目錄（使用你平常執行 `node` 的終端機環境，例如已載入 nvm 或 Homebrew PATH）：

```bash
npm run deploy:install
```

這會依目前機器推算 `node` 絕對路徑、repo 位置、`PERSONAL_TOOLS_DATA_DIR`（未設定時預設為 repo 旁邊的 `personal-tools-data/`），產生 `~/Library/LaunchAgents/com.personal-tools.web.plist` 並載入啟動。

- 若要先預覽產生的 plist 與指令而不實際安裝：
  ```bash
  bash deploy/macos/install.sh --dry-run
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

可用 `tail -f ~/Library/Logs/personal-tools/web.*.log` 即時查看。

## 出事時手動停止／重啟

```bash
# 手動停止（不會因 KeepAlive 立刻重啟）
launchctl bootout "gui/$(id -u)/com.personal-tools.web"

# 手動啟動
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.personal-tools.web.plist"
```

## 移除

```bash
npm run deploy:uninstall
```

會卸載 LaunchAgent 並刪除 `~/Library/LaunchAgents/com.personal-tools.web.plist`（不會刪除資料庫或 log）。

## 換 Node 版本之後

已安裝的 plist 裡寫死了 `node` 執行檔的絕對路徑，且 `better-sqlite3` 是原生 C++ 模組（綁定 Node ABI 版本）。更換或升級 Node 版本後，請在新的 Node 環境下依序執行：

```bash
npm rebuild better-sqlite3
npm run deploy:install
```
