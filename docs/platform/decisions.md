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
| 各工具的錯誤類別繼承 `src/platform/errors.ts` 的基底,`src/app/api/_lib/http.ts` 只認基底(2026-11-15) | 原本 `http.ts` 匯入 tasks 的錯誤類別:平台依賴工具,而且 finance 的驗證錯誤認不出來、回 500。放棄:共用同一組類別(錯誤要定義在各工具)、每個工具一份 `http.ts`(錯誤形狀兩處維護)、比對 `error.name`(改名就默默失效) |
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
| finance 的畫面沿用同一套色票與語意層,不另設主題色、不覆寫語意層(2026-11-15 記入;finance 的決策紀錄 2026-11-13 定案) | 兩個工具外觀一致;使用者提供的參考色票之後用在 finance 的分類色(圖表、分類標記),不用在底色、側欄、選取 |

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
| 根路徑 `/` 是首頁:每個工具提供自己的小工具元件與摘要 API,首頁只負責排版(依賴方向:首頁 → 工具公開的小工具)。分兩段:先只有工具入口;摘要小工具等工具有對應的讀取函式再加(finance 要等 `reports`)。2026-11-15 | 摘要要顯示什麼由工具決定,加新工具只是多一個小工具。放棄:首頁自己呼叫各工具 API 並決定呈現(呈現邏輯會集中在首頁、跟工具脫節);首頁直接匯入各工具的 `server/`(平台依賴工具,也違反畫面經過 API 的規則) |
| 資料庫放在 repo 外:`PERSONAL_TOOLS_DATA_DIR`(預設 repo 旁邊的 `personal-tools-data/`),每個工具一個子資料夾。取代原本 repo 內的 `data/` | finance 的資料是財務資料,資料與程式實體分開比靠 `.gitignore` 穩;兩個工具用同一條規則。位置由 `src/platform/dataDir.ts` 推算 |
| 不屬於任何一個工具的共用程式放 `src/platform/`;模組可以匯入 platform,platform 不匯入模組 | 依賴單向。共用設計系統還沒做(之後由使用者開 session),這裡只放沒有畫面的基礎設施 |
| finance(原本的 PACR)搬進 `src/modules/finance/`:schema 與 migration、ledger(收款人、餘額)、fx、從 PACR v2 匯入的工具。還沒有頁面與 API | 地基先在 `CageHong/pacr` 獨立做完才併入。finance 的決策紀錄與進度檔含個人財務資料,留在 repo 外,不放進這個 repo |
| `packages/<套件>/` 用 npm workspaces(根 `package.json` 的 `workspaces: ["packages/*"]`),套件名稱 `@personal-tools/<套件>`;套件的 `exports` 直接指向 `src/index.ts`,不編譯;套件不匯入 `src/` | 套件是「沒有資料庫、沒有畫面、可以單獨測試」的純函式(第一個是 `statement-parsers`),用套件邊界保證它不會依賴到模組。不編譯:不需要建置步驟與 `dist/`,tsx 與 tsc 直接讀原始碼;代價是 Next.js 的程式匯入時要加 `transpilePackages`(`docs/platform/backlog.md`)。名稱加前綴:不會跟 npm 上的公開套件撞名。2026-11-13 |
| migration 一律經過 `src/platform/migrations.ts` 的 `runMigrations`:transaction 外關外鍵 → Drizzle 的 migrate → `PRAGMA foreign_key_check`(有斷掉的參照就報錯)→ 開回外鍵。`<工具>:db:migrate` 改成各工具的 `tools/migrate.ts` | SQLite 改 CHECK、改欄位要重建資料表;Drizzle 把 migration 包在 transaction 裡,transaction 裡關不掉外鍵,DROP 有 `ON DELETE CASCADE` 子表的資料表會把子表刪光(在 finance 的真實資料複本上重現過)。tasks 也有 cascade,所以做在平台層。在 transaction 外關外鍵是 SQLite 官方文件的重建步驟,Drizzle Kit 產生的 SQL 因此可以直接用。代價:檢查在 Drizzle 提交之後,查到問題只能報錯,不能回滾。放棄自己寫 migrator(要自己維持 `__drizzle_migrations` 的相容)、拿掉 cascade、enum 不用 CHECK、換工具。2026-11-14 |
| 每個工具一支 `db/migrations.test.ts`:只套到倒數第二個 migration → 灌虛構的種子 → 套最新的 → 原本就有的每張表筆數相同、外鍵檢查為空(`src/platform/testing/migrationCheck.ts`) | 擋住寫錯的 migration(上一條的檢查只能事後報錯)。只檢查最新的那個:每個 migration 在它是最新的那段期間都會被檢查到;種子只要維持一個版本。2026-11-14 |

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

## 6. 副線開發者(Gemini / Antigravity)

規則在 `AGENTS.md`,任務卡在 `docs/ag-cards/`(合併後移到 `done/`)。

| 決策 | 理由 |
|---|---|
| 副線在獨立的 git worktree 與分支 `gemini/<任務名>` 工作,資料夾是假資料;成果經主線審查後才併進 main。2026-11-13 | 副線看不到真實資料;主線保有併入前的最後檢查 |
| 寫入交易的 finance 程式(schema、migration、ledger、import、classify、recurring)只由主線做;tasks 的 schema 開放給副線,但只在任務卡列出時。2026-11-14 | finance 的錯誤會弄壞真實帳本,而且這些程式共用「每個幣別加總為零」等不變量;tasks 目前主線沒在動,不開放的話目標、清單、標籤、排程都只能等主線。schema 變更仍有 `migrations.test.ts` 與主線審查把關 |
| 副線同時也做主線切片的審查(只讀,報告寫在 `docs/ag-cards/`) | 換一個模型、沒有對話歷史的審查,避免寫程式的人替自己的程式辯護 |
| 分工以省主線 token 為原則:主線(Claude)做決策討論、規格、測試、審查與 finance 寫入交易的程式;實作、探索程式碼、UI 預設交給副線。主線在使用者要動手實作時,先判斷能否交給副線並主動提出。2026-11-21 | 副線的 token 便宜得多;主線最貴的是讀程式碼與逐行寫實作 |
| 任務卡改短:引用 `decisions.md` 的章節(「實作 §6i 第 1–4 條」),不重述規則;只寫目標、引用、可改 / 不可改的檔案、完成條件。2026-11-21 | 決策已集中在各層 `decisions.md`;重述既花 token 又會與原文漂移 |
| 邏輯複雜的切片由主線先寫測試當規格,副線實作到全過;主線審查看測試與回報指出的風險點,不逐行讀 diff。2026-11-21 | 測試比文字規格短而精確;審查成本跟著下降 |
| 規模大或要先探索程式碼的卡,副線先在卡上寫實作計畫(要改的檔案與步驟),停下等主線確認再實作。2026-11-21 | 把探索的成本放在副線;主線看幾行計畫就能判斷方向 |
| 副線回報必須寫:每個完成條件怎麼驗證的、最可能出錯的地方。2026-11-21 | 主線審查直接看這些地方 |

## 7. 工具切換(規劃中,尚未實作)

2026-11-21 定案。起因:首頁有各工具的入口,但進了工具沒有任何回首頁或切到別的工具的方式;finance 有自己的側欄,tasks 沒有外框。參考 TickTick 最左的功能欄、Google 的應用程式九宮格、macOS 的選單列。

| 決策 | 理由 |
|---|---|
| 所有頁面(含首頁)最上方一條全域頂列;左邊是九宮格按鈕加目前工具名稱,右邊是狀態列 | 每一頁都有同一個出入口,沒有「進得去、出不來」的頁面。放棄 TickTick 式常駐左窄欄:吃掉 tasks 三欄的寬度,窄螢幕還要另外設計收合;放棄滑到邊緣才彈出:tasks 的分類欄貼著左邊,會一直誤觸,也不能用在觸控 |
| 九宮格點開是面板,列出首頁與各工具 | 同 Google 的做法:不佔寬度,手機上同一套 |
| 只列工具,不列工具內的功能(習慣、日曆、矩陣留在 tasks 的分類欄) | 規則單純:頂列切工具,工具自己的側欄切功能。finance 子頁很多,攤平會讓兩個工具規則不一致 |
| 習慣不從 tasks 拆成獨立工具 | 習慣與任務同一個 SQLite 檔;`habit.goal_id`、日曆、「今天」同時顯示習慣與任務都需要兩邊的資料,拆開後受 §4「模組之間不直接匯入」限制,只能繞 API 互查 |
| 點工具時回到上次在該工具停留的網址(含查詢參數),沒有紀錄才去工具首頁 | 切換很頻繁;回到原處補回「兩次點擊」的成本。存在瀏覽器端(localStorage,失敗就退回工具首頁),是單人單瀏覽器的便利功能,不進資料庫 |
| ~~第一階段就做快捷鍵;用序列鍵(例如 `g` 再按工具字母)~~ → 2026-11-21 改成**不做快捷鍵** | 使用者沒有記新快捷鍵的習慣,任何平台都不用;切換靠九宮格加「回到上次網址」 |
| 工具清單(名稱、網址、說明、圖示、主題色)集中在 `src/platform/tools.ts`;首頁入口與頂列都讀這份 | 新增工具只加一行;主題色之後有地方放。它是資料不是畫面,符合 §4「platform 不放畫面」 |
| 頂列元件放 `src/app/_shell/`,由根 layout 掛載;工具只負責頂列以下的區域 | 第一個平台層級的畫面元件;共用設計系統還沒做,先不進 `src/platform/`,做設計系統時再整理 |
| 圖示先用文字縮寫或系統 emoji | 正式圖示屬於共用設計系統,由使用者自己開 session |
| 工具名稱統一顯示在頂列;finance 側欄最上方的「finance」標題拿掉 | 同一個資訊不出現兩次 |
| 狀態列第一階段留空;之後放各工具的一眼數字(例如今天剩幾個任務、習慣進度、本月支出),沿用首頁第二段的摘要 API | 要放哪些數字使用者要邊用邊想;資料來源與首頁小工具同一套,不另做 |

待決:頂列高度(約 32px 起討論)。

## 8. 通知(發送層已實作,runner 未做)

2026-11-21 定案。起因:習慣要提醒,而且使用者有不少工具都需要通知(phd-radar 已經用 Telegram bot)。

| 決策 | 理由 |
|---|---|
| 通知是平台層的能力,不是 tasks 自己的功能 | 多個工具都需要;發送管道只該有一份 |
| 分成兩層:「什麼時候、通知什麼」由各工具決定(資料在各工具自己的 DB,包括「已送出」的標記);「怎麼送」由平台負責(`src/platform/notify/`,只有發送介面與管道實作,不存狀態) | 換管道(例如改成 Web Push)只換發送層,工具的規則與資料不動;平台維持沒有資料庫 |
| 第一階段管道:新開一個 Telegram bot(不沿用 phd-radar 的) | phd-radar 已驗證過這條路;手機電腦都收得到,不需要 HTTPS 與 PWA。分開的 bot 讓論文通知與生活提醒不混在一起 |
| bot token 與 chat id 放 `PERSONAL_TOOLS_DATA_DIR`,不進 repo | 是密鑰 |
| 排程:一支 runner 程式由 launchd 定時執行(每幾分鐘),呼叫各工具公開的「到期提醒」函式,交給平台發送,再讓工具標記已送 | 瀏覽器關掉時沒有東西會主動跳出來,一定要有獨立排程。依賴方向同首頁小工具:runner → 工具公開的函式 → 平台;平台不匯入工具 |
| 放棄(第一階段):Web Push(要 HTTPS 憑證、iPhone 要加到主畫面,實作量大)、macOS 原生通知(只有那台 Mac 收得到) | 之後若要可在通知上直接操作,再評估 Web Push |

之後可能:讓 repo 外的工具(phd-radar、tidy)也透過 personal-tools 發通知,使它成為通知中心。還沒決定,不要主動做。

**runner(2026-11-22 定案)**

| 決策 | 理由 |
|---|---|
| runner 放 `src/jobs/notify.ts`,不放 `src/platform/` | 它要匯入各工具的公開函式,`src/platform/` 不匯入模組;它也不是頁面,不放 `src/app/` |
| 工具的通知入口由 `src/jobs/notifiers.ts` 對照 `src/platform/tools.ts` 的工具清單取得;每個工具公開兩個函式:`dueNotifications(now)` 回傳到期的通知(各帶一個 key),`markSent(keys)` 標記已送。清單裡的工具沒有通知入口就略過 | 同 §10「工具之間只透過公開函式往來,而且要容許對方不存在」 |
| 一個 tick:對每個工具取到期通知 → 逐則交給 `sendNotification` → 送成功的才 `markSent`;一則失敗不影響其他則 | 「已送」由工具記,平台不存狀態(本節第二列) |
| 送失敗不標記,下一個 tick 自然重試,不設重試上限 | 失敗多半是網路;補送窗口(由工具決定)過了就不會再送,不會無限重試 |
| 每 15 分鐘一次(2026-11-22 由原定的 5 分鐘改),launchd `StartInterval`,plist 照 `deploy/macos/*.plist.template` 的範本機制另加一份 | §9 已定;網頁與 runner 互相獨立。提醒最多晚 15 分鐘到,對摘要與習慣提醒都夠用;間隔只是一個數字,之後要調再改 |
| runner 直接執行 repo 裡的原始碼,不像網頁跑 deploy 時 build 的成品;接受「主 repo 切到別的分支時,runner 跑的是那個分支」,寫進 `deploy/macos/README.md` | 開發多半在獨立 worktree,主 repo 很少離開 main;跑錯分支頂多讓通知失敗,下一個 tick 會重送。另做 runner 的成品會讓 deploy 多一步,不值得 |
| 時間一律用這台機器的本地時間 | 個人工具,只有一個時區 |



## 9. 運行與部署

2026-11-22 定案。起因:不想每次開終端機啟動。第一階段只在使用者的 MacBook 上跑;換機器見 §10。

| 決策 | 理由 |
|---|---|
| 正式版用 `next build` + `next start` 跑在固定 port(預定 3100),由 launchd LaunchAgent 管理:登入時啟動、當掉自動重開。開發照舊 `npm run dev`(3000) | 平常用的版本不依賴終端機;開發中的半成品不會影響平常使用 |
| 更新正式版只有一個指令(`npm run deploy`):確認在 `main` → 測試 → 停正式版 → migrate → build → 啟動 | migration 時正式版不能開著;步驟固定才不會漏。斷線約一分鐘,個人工具可接受 |
| 正式版與開發版的建置輸出分開(正式版另設輸出資料夾) | `next build` 會覆寫輸出資料夾,共用的話會把正在跑的另一個弄壞 |
| 通知 runner(§8)是另一個 launchd job,每 15 分鐘(§8);與正式版互相獨立 | 網頁掛了不影響提醒,反之亦然 |
| SQLite 改開 WAL(目前沒開) | 正式版、開發版、runner 會同時讀寫同一份正式資料 |
| 接受 MacBook 睡眠時全部停止。runner 找「到期而且還沒送」的提醒,醒來時補送;太舊的跳過不送 | 使用者接受睡眠的限制;補送讓睡眠不會漏提醒,跳過避免一次湧進一堆 |
| 打開方式:Safari 的「加入 Dock」 | 不用碰終端機,用起來像一般 app |
| 跑法相關的檔案(launchd plist、deploy 腳本)放 `deploy/macos/`,不混進 `src/` | 跑法是「這台機器怎麼跑」,不是程式的一部分;換機器(§10)只是多一種跑法 |

之後要做,但不急:手機存取(Tailscale 網內用 `tailscale serve` 提供 HTTPS)。

## 10. 未來彈性:換機器與給別人用(只是方向,不實作)

2026-11-22。以下都是之後**可能**的方向,寫下來是為了讓現在的開發不把路堵死。不要主動實作,也不要主動提議開始做。

**可能的方向**
- **換到常開的機器**:正式版搬到使用者的舊 MSI 筆電(傾向重灌 Ubuntu Server、用 systemd),Mac 只做開發。搬的時候要處理:掃描 Mac 上的 `OB_*/待辦.md`(同步或由 Mac 推送)、對帳單與收據改成上傳或由伺服器自己抓、正式資料的備份。
- **給別人用**:先是同學朋友(大多不是電腦背景),之後也許放上 GitHub。模式定為 A(別人自己架)+ C(把單一工具拆出去);B(使用者架站、多人登入)只有商品化才考慮。Claude 提過、未定:非電腦背景的朋友實際上自己架不起來,可能改用「小規模 B」:經 Tailscale 用使用者的伺服器、每人一份資料夾、只開放低敏感的工具,Finance 只給使用者本人。

**現在就要守的規則**

| 規則 | 理由 |
|---|---|
| 個人的東西(路徑、token、chat id、帳戶名稱等)不寫進程式碼,放 `PERSONAL_TOOLS_DATA_DIR` 或設定檔 | 換機器或給別人用時,不用改程式 |
| 工具之間只透過公開函式往來,而且要容許對方不存在。首頁、頂列、通知 runner、待辦掃描從工具清單(`src/platform/tools.ts`)得知有哪些工具,不寫死某個工具一定在 | 拆出單一工具(C),或別人只啟用部分工具時,不會壞掉 |
| 不在資料表加 `user_id`;之後真的要多人,用每人一份資料夾隔開 | 每個工具本來就是一份 SQLite,用資料夾隔開最便宜,不必改 schema |
| 讀使用者電腦上檔案的功能(例如待辦掃描),讀取位置走設定,不假設程式和檔案在同一台機器 | 搬到伺服器時只換讀取來源 |
