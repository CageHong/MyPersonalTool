# 平台決策紀錄

本檔記錄 personal-tools 平台層級(所有工具都適用)的決策與理由。規則在根目錄的 `CLAUDE.md`,本檔放「為什麼這樣定」。各工具的決策在 `docs/<工具>/decisions.md`(finance 的含個人財務資料,在 repo 外)。
新決策定案後追加到對應章節;推翻舊決策時保留舊的一行,註明改成什麼、為什麼。

§1–§4 是 2026-11-13 從任務管理的決策紀錄(現在的 `docs/tasks/decisions.md`)搬過來的:原本的 §1、§3、§7 的前五條與深色模式、§9。內容不變,只把寫成 `src/modules/tasks/` 的路徑改成 `src/modules/<工具>/`(這些決策本來就是所有工具共用,只是當時只有一個工具)。

---

## 1. 架構

| 決策 | 理由 |
|---|---|
| 單一 Next.js app,不拆獨立 API server | 一個 process,部署最簡單;長期要搬家的需求由下一條紀律保證 |
| 業務邏輯一律寫在 `src/modules/<工具>/server/` 的純函式;route handler 只解析請求、呼叫函式、回傳 JSON | API 之後要搬到獨立伺服器,邏輯不綁框架,搬家時只換入口 |
| 驗證邏輯(如標題不可為空)放 `src/modules/<工具>/server/`;協定層解析(如網址 id 不是數字)放 route handler | 純函式是唯一入口:之後的產生邏輯或匯入 script 直接呼叫 `server/` 時,驗證不會被繞過。協定層解析則是 HTTP 才有的問題,搬家時會跟著入口一起換掉 |
| 驗證失敗時 throw 自訂錯誤類別(帶 `fields`),定義在 `src/modules/<工具>/server/`;route handler 用 `instanceof` 對映到狀態碼 | `server/` 不可以知道 HTTP 的存在 |
| 前端不從 `src/modules/<工具>/server/` import 任何東西,包括型別 | `import type` 雖不會被打包,但搬家時仍是要拆的相依 |
| 技術棧:TypeScript、Drizzle + better-sqlite3、SQLite、CSS Modules | 已定案,不提替代方案(Prisma、Tailwind、Postgres 等) |
| 各工具分開 SQLite 檔,表名保留前綴 | 工具之間資料獨立,首頁摘要另行處理 |
| 登入暫不做,身分檢查獨立成中介層 | 只在 Tailscale 網內使用 |

## 2. API

| 決策 | 理由 |
|---|---|
| REST 風格,錯誤碼三種:`VALIDATION_FAILED`(400)、`NOT_FOUND`(404)、`INTERNAL_ERROR`(500) | 所有工具共用同一套錯誤形狀 |

## 3. 樣式基礎(`src/app/globals.css`)

| 決策 | 理由 |
|---|---|
| CSS 變數分兩層:色票層 `--palette-*`(名字只描述顏色)與語意層 `--color-*`(名字描述用途);元件只引用語意層 | 調色只動色票層,元件不必改(本條取代 Session 3 的「單層語意」) |
| 元件 `.module.css` 不寫死顏色、間距、字級、字重、字型 | 之後抽共用設計系統時不必逐檔翻找 |
| 字型用系統字型堆疊,不載入字型檔;中文 fallback 指定蘋方/微軟正黑體 | 目前主要在 MacBook 上用;跨裝置一致等做共用設計系統時再決定 |
| 字級、字重已 token 化,字級以 rem 表示 | 改字級只動 `:root` |
| 鍵盤焦點:全域 :focus-visible 用 ink-soft 外框,偏移 2px | 全頁單一顏色;偏移讓外框畫在頁面底色上,因此不受按鈕底色影響(ink 在 accent 上只有 2.82) |
| 深色模式暫不做 | 語意層命名保證之後只需加一組覆寫 |

finance 的畫面怎麼套用這一層還沒定,見 `docs/platform/backlog.md`。

## 4. 平台結構(personal-tools)

第二個工具(finance,原本的 PACR)要進來,所以先把「平台」和「工具」分開。2026-11-13 定案。

| 決策 | 理由 |
|---|---|
| 這個 repo 就是 personal-tools 的 repo;單一 repo、一條歷史,不用 submodule 或 subtree | 單一 Next.js app(§1)之下工具不自足:頁面入口與套件版本在平台這一層,拆成多個 repo 一個改動要兩邊各 commit 一次。看單一工具的歷史用路徑篩選(`git log -- src/modules/tasks`),commit 訊息加工具前綴 |
| 目錄用工具優先:每個工具一個資料夾 `src/modules/<工具>/`,裡面是 `server/`、`db/`、`components/`、`lib/`、`drizzle/` | 一個工具的東西集中在一處,每加一個工具只多一個資料夾。放棄層優先(`src/server/<工具>/`):工具的東西會分散在四個地方 |
| 頁面與 route handler 仍在 `src/app/` 底下 | App Router 規定路由在 `src/app/`;route handler 只解析請求、呼叫模組的函式(§1 不變) |
| 模組之間不直接匯入對方的 schema 或 server 函式 | 工具之間資料獨立(§1「各工具分開 SQLite 檔」的延伸) |
| 每個工具自己的 Drizzle 設定檔與 migration 資料夾,指令加工具前綴(`npm run tasks:db:generate`) | 各工具分開 SQLite 檔,migration 的紀錄也要分開 |
| 每個工具的頁面在 `/<工具>`,API 在 `/api/<工具>/…`;任務管理是 `/tasks` 與 `/api/tasks/…`,任務這個資源因此是 `/api/tasks/tasks` | 規則只有一條、沒有例外。放棄「任務維持 `/api/tasks/:id`,其他資源搬到 `/api/tasks/` 底下」:同一層會同時有任務 id 與其他資源的名稱 |
| 根路徑 `/` 只轉址到 `/tasks`,不做首頁 | 首頁 shell 仍然列為不做(`docs/platform/backlog.md`);之後要做再換掉這一頁 |
| 資料庫放在 repo 外:`PERSONAL_TOOLS_DATA_DIR`(預設 repo 旁邊的 `personal-tools-data/`),每個工具一個子資料夾。取代原本 repo 內的 `data/` | finance 的資料是財務資料,資料與程式實體分開比靠 `.gitignore` 穩;兩個工具用同一條規則。位置由 `src/platform/dataDir.ts` 推算 |
| 不屬於任何一個工具的共用程式放 `src/platform/`;模組可以匯入 platform,platform 不匯入模組 | 依賴單向。共用設計系統仍然不做,這裡只放沒有畫面的基礎設施 |
| finance(原本的 PACR)搬進 `src/modules/finance/`:schema 與 migration、ledger(收款人、餘額)、fx、從 PACR v2 匯入的工具。還沒有頁面與 API | 地基先在 `CageHong/pacr` 獨立做完才併入。finance 的決策紀錄與進度檔含個人財務資料,留在 repo 外,不放進這個 repo |
| `packages/<套件>/` 用 npm workspaces(根 `package.json` 的 `workspaces: ["packages/*"]`),套件名稱 `@personal-tools/<套件>`;套件的 `exports` 直接指向 `src/index.ts`,不編譯;套件不匯入 `src/` | 套件是「沒有資料庫、沒有畫面、可以單獨測試」的純函式(第一個是 `statement-parsers`),用套件邊界保證它不會依賴到模組。不編譯:不需要建置步驟與 `dist/`,tsx 與 tsc 直接讀原始碼;代價是 Next.js 的程式匯入時要加 `transpilePackages`(`docs/platform/backlog.md`)。名稱加前綴:不會跟 npm 上的公開套件撞名。2026-11-13 |

## 5. 規則與文件的分層

2026-11-13 定案。原本 `CLAUDE.md` 與 `docs/` 寫的都是任務管理的規則,平台規則混在裡面並寫成 tasks 的路徑;finance 的規則在 repo 外。

| 決策 | 理由 |
|---|---|
| 規則分三層:根目錄 `CLAUDE.md`(平台)、`.claude/rules/<工具>.md`(工具,用 `paths` 涵蓋該工具的所有位置)、`packages/<套件>/CLAUDE.md`(套件) | Next.js 規定路由在 `src/app/`,一個工具的檔案分散在 `src/modules/`、`src/app/`、`src/app/api/`、`packages/`;只有路徑模式剛好對得上一個工具的範圍。放棄只在 `src/modules/<工具>/` 放 CLAUDE.md:子資料夾的 CLAUDE.md 要讀到那個資料夾的檔案才載入,先動 route handler 時不會載入。放棄每個位置各放一個指引用的 CLAUDE.md:檔案多,指引檔載入了主檔不一定會被讀 |
| 根目錄 `CLAUDE.md` 保留「路徑 → 工具 → 規則檔」對照表 | 依路徑自動載入是 Claude Code 的行為;其他環境只靠這張表 |
| 工具規則可以比平台規則嚴,不能放寬;看起來衝突時先停下來問 | 平台規則是跨工具的契約 |
| 文件依層分:`docs/platform/`、`docs/<工具>/`;決策紀錄也是每層一份 | 分類的單位跟規則檔一致(工具,不是資料夾)。搬 docs 本來就要改所有 `decisions.md` 的引用,所以決策紀錄直接拆乾淨。放棄只把平台決策抽出、tasks 的留在原檔:搬家的成本一樣,結構不乾淨 |
| repo 內的規則與文件不引用 repo 外的決策編號,每條規則本身寫完整 | finance 的決策紀錄含個人財務資料,留在 repo 外;在 repo 裡讀到查不到的編號等於沒寫 |
| 放棄:不拆、一個 CLAUDE.md 分三段、根檔放各工具的摘要、工具規則放 `docs/<工具>/` 只靠對照表 | 不拆:做 finance 時要自己判斷哪些 tasks 規則適用。分段:context 隨工具數量線性成長。摘要:同一條規則寫兩次。只靠對照表:放棄 Claude Code 的按需載入 |
