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

### 1. 建置輸出資料夾分離(`next.config.ts`、`.gitignore`)
- `next.config.ts`:依 Next.js `distDir` 文件,當環境變數 `NEXT_DIST_DIR` 有設定時將其傳入 `nextConfig.distDir`,未設定時維持預設(`.next`,供 `npm run dev` 使用)。正式版與 `npm run deploy` 使用 `NEXT_DIST_DIR=.next-prod`。
- `.gitignore`:加入 `/.next-prod/`。

### 2. SQLite 開啟 WAL(`src/modules/tasks/db/index.ts`、`src/modules/finance/db/index.ts`)
- `src/modules/tasks/db/index.ts`:在 `sqlite.pragma('foreign_keys = ON')` 後加入 `sqlite.pragma('journal_mode = WAL')` 與簡短註解(供正式版、開發版、runner 並存讀寫)。
- `src/modules/finance/db/index.ts`:在 `openDb(path)` 的 `sqlite.pragma('foreign_keys = ON')` 後,當 `path !== ':memory:'` 時執行 `sqlite.pragma('journal_mode = WAL')` 與簡短註解。兩檔其餘程式碼皆不動。

### 3. macOS launchd 與 deploy 腳本(`deploy/macos/`)
設計成「凡符合 `deploy/macos/*.plist.template` 的範本皆由同一套安裝／移除機制處理」,之後通知 runner 只要新增 `com.personal-tools.notify.plist.template` 即可沿用。

- `deploy/macos/com.personal-tools.web.plist.template`:
  - `Label`:`com.personal-tools.web`
  - `ProgramArguments`:`[__NODE_BIN__, __REPO_DIR__/node_modules/next/dist/bin/next, start, -p, __PORT__]`(直接以 node 絕對路徑執行 Next CLI,避免 launchd 的極短 `PATH` 找不到 `node`)
  - `WorkingDirectory`:`__REPO_DIR__`(確保 `src/platform/dataDir.ts` 與 `MIGRATIONS_FOLDER` 的 `process.cwd()` 指向 repo 根目錄)
  - `EnvironmentVariables`:設定 `NODE_ENV=production`、`NEXT_DIST_DIR=__DIST_DIR__`、若推算或指定了 `PERSONAL_TOOLS_DATA_DIR` 則帶入 `PERSONAL_TOOLS_DATA_DIR=__DATA_DIR__`,並附帶含 node 所在目錄的 `PATH`
  - `RunAtLoad`:`<true/>`、`KeepAlive`:`<true/>`
  - `StandardOutPath` / `StandardErrorPath`:`__LOG_DIR__/web.stdout.log` 與 `web.stderr.log`
- `deploy/macos/install.sh`:
  - 支援 `--dry-run`(只印出產生的 plist 內容與會執行的 `launchctl` 指令,不寫檔也不執行 `launchctl`)與 `--job <name>`(選用,預設處理所有 `*.plist.template`)。
  - 在執行當下動態推算路徑(不寫死 `/Users/...` 於 repo):
    - `REPO_DIR`:由腳本位置往上兩層推算
    - `NODE_BIN`:讀取 `$NODE_BIN` 或 `command -v node` 的絕對路徑
    - `DATA_DIR`:讀取 `$PERSONAL_TOOLS_DATA_DIR` 或預設 `$(dirname "$REPO_DIR")/personal-tools-data`
    - `LOG_DIR`:讀取 `$PERSONAL_TOOLS_LOG_DIR` 或預設 `$HOME/Library/Logs/personal-tools`
    - `PORT`:讀取 `$PERSONAL_TOOLS_PORT` 或預設 `3100`;`DIST_DIR`:讀取 `$NEXT_DIST_DIR` 或預設 `.next-prod`
  - 實際安裝時建立 `LOG_DIR` 與 `$HOME/Library/LaunchAgents`,替換範本寫入 plist,並先嘗試 `launchctl bootout` 舊服務(若存在)再 `launchctl bootstrap gui/$(id -u) <plist>`。
- `deploy/macos/uninstall.sh`:
  - 支援 `--dry-run` 與 `--job <name>`(預設處理所有 `*.plist.template`)。
  - 執行 `launchctl bootout gui/$(id -u)/<label>`(未載入時忽略錯誤)並刪除 `$HOME/Library/LaunchAgents/<label>.plist`。
- `deploy/macos/deploy.sh`:
  - 支援 `--dry-run`。依 `decisions.md` §9 第 2 條依序執行:
    1. 檢查目前 git 分支為 `main`
    2. 執行 `npm test`
    3. 停止正式版(`launchctl bootout gui/$(id -u)/com.personal-tools.web`;因 `KeepAlive=true`,需用 `bootout` 而非 `stop` 才會維持停止)
    4. 套用 migration(`npm run tasks:db:migrate` 與 `npm run finance:db:migrate`,帶入正式版 `PERSONAL_TOOLS_DATA_DIR` 若有設定)
    5. 建置正式版(`NEXT_DIST_DIR=.next-prod npm run build`)
    6. 啟動正式版(`launchctl bootstrap gui/$(id -u) "$HOME/Library/LaunchAgents/com.personal-tools.web.plist"`)
  - **失敗處理**:任一步驟失敗即以 `set -euo pipefail` + 包裝函式立即中止,印出明確的失敗步驟名稱。
    - 第 1、2 步失敗時尚未停止正式版,因此**正式版保持原狀繼續運行**。
    - 第 4、5 步失敗時因正式版已於第 3 步停止,**正式版維持停止(不自動重啟)**,避免舊程式配上已變更的 DB 或殘缺的 `.next-prod` 造成損壞;錯誤訊息會提示修正後重新執行 `npm run deploy`。
- `deploy/macos/README.md`:
  - 說明前置條件、安裝(`npm run deploy:install`)、更新(`npm run deploy`)、移除(`npm run deploy:uninstall`)、查看 log(`~/Library/Logs/personal-tools/`)與出事時手動停止／重啟指令。

### 4. `package.json` 與 `docs/platform/backlog.md`
- `package.json`:新增 `deploy`、`deploy:install`、`deploy:uninstall` 三個 scripts,分別呼叫 `deploy/macos/` 對應腳本。
- `docs/platform/backlog.md`:更新「常駐運行」項目,標明已完成腳本、plist 範本、輸出目錄分離與 WAL 設定,待使用者在本機主 repo 實際安裝與測試。

### 5. 驗證方式(實作完成後)
- 執行 `npx next typegen`、`npx tsc --noEmit`、`npm run lint`、`npm test`。
- 執行 `bash deploy/macos/install.sh --dry-run`,將輸出貼入回報,並用 `grep -rn "/Users/" deploy/` 確認無寫死使用者路徑。
- 若環境有 `shellcheck`,對 `deploy/macos/*.sh` 執行檢查。
- 在 worktree 以假資料(獨立 `PERSONAL_TOOLS_DATA_DIR` 指向暫存目錄)驗證 `NEXT_DIST_DIR=.next-prod npm run build`、`npx next start -p 3100` 與 `npm run dev`(3000)可同時啟動且首頁回 200,測試後關閉兩者並清理暫存。
- **絕不執行 `launchctl` 或實際安裝任何 launchd job**。

### 主線確認(2026-11-22):照計畫實作,加上以下修改

1. **deploy 與正式版用同一份設定**:`deploy.sh` 的 migrate 與 build 所用的 `PERSONAL_TOOLS_DATA_DIR`、`NEXT_DIST_DIR`,從**已安裝的 plist** 讀(`/usr/libexec/PlistBuddy`),不要在 deploy 時重新推算。否則安裝時有設環境變數、deploy 時沒設,migration 會跑到另一份 DB。plist 不存在時直接停下,提示先跑 `npm run deploy:install`。
2. **第 1 步多檢查工作區乾淨**(`git status --porcelain` 為空),否則沒 commit 的改動會被部署上去。
3. **build 也帶上同一組環境變數**(`NODE_ENV=production`、資料夾),避免 build 時有程式讀到不同的資料夾。
4. **第 3 步的 `bootout` 在服務沒載入時不算失敗**(例如上次 deploy 在第 4、5 步失敗、正式版已經是停止狀態),繼續往下。
5. **README 加一段「換 node 版本之後」**:node 路徑寫在 plist 裡,而且 `better-sqlite3` 是原生模組;換版本後要 `npm rebuild better-sqlite3` 再 `npm run deploy:install`。這條也寫進回報的「最可能出錯的地方」。

其餘(範本機制、失敗時正式版的狀態、WAL 只在非 `:memory:` 開、不執行 `launchctl`)都照計畫。

## 回報(Gemini 填寫)
- 做了什麼(每個檔案一行):
  - `next.config.ts`:依 `process.env.NEXT_DIST_DIR` 設定 `distDir`,未設定時維持預設 `.next`。
  - `.gitignore`:加入 `/.next-prod/`。
  - `src/modules/tasks/db/index.ts`:加入 `sqlite.pragma('journal_mode = WAL')` 與註解,其餘不動。
  - `src/modules/finance/db/index.ts`:在 `openDb` 中 `path !== ':memory:'` 時加入 `sqlite.pragma('journal_mode = WAL')` 與註解,其餘不動。
  - `deploy/macos/com.personal-tools.web.plist.template`:建立 LaunchAgent plist 範本(不含寫死路徑,以 `node` 絕對路徑執行 Next CLI,port 3100、`NEXT_DIST_DIR=.next-prod`)。
  - `deploy/macos/install.sh`:建立支援 `--dry-run` 與 `--job` 的安裝腳本,動態推算 `node`、repo、`PERSONAL_TOOLS_DATA_DIR`、log 路徑並套用所有 `*.plist.template`。
  - `deploy/macos/uninstall.sh`:建立支援 `--dry-run` 與 `--job` 的移除腳本。
  - `deploy/macos/deploy.sh`:建立支援 `--dry-run` 的 deploy 腳本,依序檢查 `main` 與工作區乾淨 → `npm test` → `bootout`(未載入不算失敗)→ 從已安裝 plist 讀取 `PERSONAL_TOOLS_DATA_DIR` 與 `NEXT_DIST_DIR` 執行 migrate 與 `NODE_ENV=production` build(build 後還原 `tsconfig.json`)→ `bootstrap`,任一步失敗即停下並說明正式版狀態。
  - `deploy/macos/README.md`:撰寫安裝、更新、看 log、手動停啟、移除與「換 Node 版本之後」的操作說明。
  - `package.json`:新增 `deploy`、`deploy:install`、`deploy:uninstall` 三個 scripts。
  - `docs/platform/backlog.md`:更新「常駐運行」進度。
- 沒做什麼、為什麼:
  - 未執行 `launchctl`、未實際安裝或載入任何 launchd job(依任務卡限制,由使用者在主 repo 執行)。
  - 未修改 `eslint.config.mjs`(不在「可以改的檔案」內;詳見下方「最可能出錯的地方」)。
  - 未實作通知 runner 與 Tailscale 手機存取(另一張卡／之後項目)。
- 每個完成條件怎麼驗證的:
  - **`npx next typegen`、`npx tsc --noEmit`、`npm run lint`、`npm test`**:於移除驗證暫存 `.next-prod/` 後執行全部通過(`npm test` 65 suites、527 tests 全數通過,0 failed)。
  - **`shellcheck`**:環境未安裝(`which shellcheck` 回傳 `shellcheck not found`),無法執行。
  - **`grep -rn "/Users/" deploy/`**:輸出為空(無任何寫死使用者路徑)。
  - **同時啟動 3100 與 3000 手動驗證**:以 `PERSONAL_TOOLS_DATA_DIR=/tmp/pt-deploy-test-data` 執行 `NODE_ENV=production NEXT_DIST_DIR=.next-prod ... npm run build` 成功後,同時在背景啟動 `NEXT_DIST_DIR=.next-prod npx next start -p 3100` 與 `npm run dev`(3000),以 `curl` 檢查 `http://127.0.0.1:3100/` 與 `http://127.0.0.1:3000/` 皆回傳 HTTP 200(`prod_3100=200`、`dev_3000=200`),隨後關閉兩個 server、刪除 `/tmp/pt-deploy-test-data` 與 `.next-prod/`,並還原 `tsconfig.json`。
  - **`bash deploy/macos/install.sh --dry-run` 輸出全文**:
    ```xml
    === [dry-run] /Users/shihsiou/Library/LaunchAgents/com.personal-tools.web.plist ===
    <?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
    <plist version="1.0">
    <dict>
      <key>Label</key>
      <string>com.personal-tools.web</string>

      <key>ProgramArguments</key>
      <array>
        <string>/opt/homebrew/bin/node</string>
        <string>/Users/shihsiou/Developer/TT/gemini/personal-tools/node_modules/next/dist/bin/next</string>
        <string>start</string>
        <string>-p</string>
        <string>3100</string>
      </array>

      <key>WorkingDirectory</key>
      <string>/Users/shihsiou/Developer/TT/gemini/personal-tools</string>

      <key>EnvironmentVariables</key>
      <dict>
        <key>NODE_ENV</key>
        <string>production</string>
        <key>NEXT_DIST_DIR</key>
        <string>.next-prod</string>
        <key>PERSONAL_TOOLS_DATA_DIR</key>
        <string>/Users/shihsiou/Developer/TT/gemini/personal-tools-data</string>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
      </dict>

      <key>RunAtLoad</key>
      <true/>

      <key>KeepAlive</key>
      <true/>

      <key>StandardOutPath</key>
      <string>/Users/shihsiou/Library/Logs/personal-tools/web.stdout.log</string>

      <key>StandardErrorPath</key>
      <string>/Users/shihsiou/Library/Logs/personal-tools/web.stderr.log</string>
    </dict>
    </plist>
    === [dry-run] commands ===
    mkdir -p "/Users/shihsiou/Library/Logs/personal-tools" "/Users/shihsiou/Library/LaunchAgents"
    launchctl bootout "gui/501/com.personal-tools.web" 2>/dev/null || true
    launchctl bootstrap "gui/501" "/Users/shihsiou/Library/LaunchAgents/com.personal-tools.web.plist"
    ```
- 最可能出錯的地方:
  1. **換 Node 版本後原生模組與 plist 路徑失效**:plist 寫死了 `node` 絕對路徑,且 `better-sqlite3` 是綁定 Node ABI 的原生模組;換版本後必須先執行 `npm rebuild better-sqlite3` 再執行 `npm run deploy:install`(已寫入 `deploy/macos/README.md`)。
  2. **`eslint.config.mjs` 尚未忽略 `.next-prod/**`**:實測在 `.next-prod/` 存在時執行 `npm run lint`,eslint 會掃描 `.next-prod/server/...` 並報錯。因為 `eslint.config.mjs` 不在任務卡「可以改的檔案」內未動;主 repo 跑 `npm run deploy` 產生 `.next-prod/` 後,建議在 `eslint.config.mjs` 的 `globalIgnores` 補上 `".next-prod/**"`。
  3. **`next build` 帶 `NEXT_DIST_DIR=.next-prod` 會自動改寫 `tsconfig.json`**:實測 Next.js 會將 `.next-prod/types/**/*.ts` 寫入 `tsconfig.json`,導致工作區變髒、下次 `deploy.sh` 第 1 步會被擋下;已在 `deploy.sh` 第 5 步 build 成功後加上 `git checkout -- tsconfig.json`。
- 疑問:
  - 是否要由主線在 `eslint.config.mjs` 的 `globalIgnores` 補上 `".next-prod/**"`?
