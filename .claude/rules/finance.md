---
paths:
  - "src/modules/finance/**"
  - "src/app/finance/**"
  - "src/app/api/finance/**"
  - "packages/statement-parsers/**"
  - "packages/receipt-parsers/**"
---

# finance(複式簿記記帳)

原本的 PACR。平台規則在根目錄的 `CLAUDE.md`(錯誤契約、樣式、風險分級、紀律都在那裡);本檔只放 finance 自己的規則。

## repo 外的文件

finance 的進度(`STATUS.md`)、決策紀錄(`DECISIONS.md`)、舊版 Python 程式(v1、v2 管線)與資料在 repo 外的工作資料夾 `~/Documents/main_vault/setup_pacr/`。這些含個人財務資料,不進這個 repo。

- 動 finance 之前先讀那邊的 `STATUS.md` 與 `DECISIONS.md`;沒有連接那個資料夾時先問。
- 新決策寫進那邊的 `DECISIONS.md`;工作結束時更新那邊的 `STATUS.md`。
- repo 內不引用那邊的決策編號:會影響寫程式的規則,完整寫在本檔。

## 位置

- 資料:`<資料夾>/finance/`(`finance.db`、匯入設定 `import-v2.json`);資料庫位置只在 `src/modules/finance/db/path.ts` 定義(`FINANCE_DB_PATH` 只給測試用)
- `src/modules/finance/tools/`:命令列工具(從 v2 匯入、匯入驗證、匯率更新、對帳單匯入)
- 資料檔的位置(資料庫、套用前的備份、`import-v2.json`)只在 `db/path.ts` 定義;route handler 用的共用連線是 `db/index.ts` 的 `getDb()`(資料庫不存在就報錯,不自動建立)
- 畫面:`src/app/finance/<頁面>/`(子路由,`src/app/finance/layout.tsx` 放 finance 的側欄導覽,只列做好的頁面);元件在 `src/modules/finance/components/`;畫面一律是 client component 呼叫 `/api/finance/...`,不用 Server Component 或 Server Actions 直接呼叫 `server/`
- `src/modules/finance/lib/`:前後端共用的型別與純函式(API 回傳的形狀、金額與日期的顯示、API 錯誤的中文訊息)
- `docs/finance/`:描述性文件。動對帳單匯入之前先讀 `docs/finance/import.md`,動自動分類之前先讀 `docs/finance/classify.md`,動交易清單的查詢之前先讀 `docs/finance/transactions.md`
- `src/modules/finance/config.example/`:設定檔範例;新增設定欄位時同步更新
- 指令(repo 根目錄):`finance:import-v2`(要設 `PACR_DATA_DIR`,或把 v2 的 `finance.db` 路徑當參數)、`finance:import-statement`(對帳單檔案當參數;不加 `--apply` 只試跑)、`finance:fx-update`、`finance:db:generate`、`finance:db:migrate`

## 資料模型

- `src/modules/finance/db/schema.ts` 是資料模型的唯一定義;改完跑 `npm run finance:db:generate`,不要手改產生出來的 migration。Drizzle Kit 產生不出來的東西(trigger、含運算式的索引)寫在手寫 migration。
- 表名一律 `finance_` 前綴 + 複數;Drizzle 的變數名是「`finance` + 複數」(例:`financeSettings`)。
- 金額一律是最小貨幣單位的整數;正 = 借、負 = 貸。不要引入浮點金額欄位。
- 時間存 UTC 的 ISO 8601 文字,只在顯示時轉時區(tasks 用 Unix 秒;finance 不跟著改)。
- 分類是帳戶(`expense` / `income`),交易上不加 category 欄位。標籤掛在交易上。
- 先付出去、之後會回來的錢(保證金、代墊)記在資產帳戶,不記成支出;收回時沖減該帳戶。
- 「之後」的功能(貸款明細、持股、標的、價格歷史)不預先建表,用到時再加 migration。
- migration 的套用與檢查照平台規則(`runMigrations`、`db/migrations.test.ts`)。重建資料表的 migration(SQL 裡有 `DROP TABLE`)另外在真實資料庫的複本上跑一次 `finance:db:migrate`(用 `FINANCE_DB_PATH` 指到複本),比對每張表的筆數。

## 寫入規則

- 任何寫入交易的程式:表頭與分錄包在同一個 DB transaction,提交前確認每個幣別加總為零。
- 寫入交易與分錄只經過 `ledger/transactions.ts`(`createTransaction` 等);它收 `FinanceConn`,可以被包在外層的 DB transaction 裡。業務錯誤用 `server/errors.ts` 的 `ValidationError`(帶 `fields`)、`NotFoundError`。
- 匯入不覆蓋帳本裡已經有的交易(用來源的 ID 判斷):分類、標籤、拆分、分錄都不動。唯一自動做的修正是「入帳、對象是帳戶持有人自己」的換成匯款人;金額不同只回報。
- 匯入要能重複執行:同一份檔案套用兩次,第二次不寫任何東西。
- 自動分類只補未分類的交易,不覆蓋使用者給過的分類。目前只用在匯入的新交易:匯入時直接寫成決定的分類,不先寫未分類再搬。
- 自動分類的順序(付出):週期項目 → 對象規則 → 對象歷史 → 來源分類規則;入帳只看來源分類規則(指到支出分類 = 沖銷);換匯不分類。對象歷史只算使用者給的分類(`legacy`、`correction`、`manual`),不算自動分類的結果。細節在 `docs/finance/classify.md`。
- 針對個別交易的人工更正(拆分、收回、轉帳到自己的帳戶、對帳調整)是 ledger 的編輯操作,不靠設定檔。
- 單筆編輯(分類、對象、日期時間、備註、標籤、整組替換分錄)只經過 `ledger/transactions.ts` 的 `updateTransaction`:帶上讀取時的 `updatedAt`,不同就拒絕;分類或分錄真的換了才重算 `category_source`(有使用者選的分類 = `manual`,否則 `null`)。細節在 `docs/finance/transactions.md` 的「編輯」。
- 手動新增(畫面上的新增交易、對帳調整)只經過 `ledger/transactions.ts` 的 `createManualTransaction`;範本(`lib/templates.ts`)只把表單變成分錄,不寫入。
- 刪除交易只經過 `ledger/transactions.ts` 的 `deleteTransaction`:有來源 ID 的把 ID 記進 `finance_deleted_external_ids`,匯入看到這個 ID 就不加回來。其他查詢(餘額、清單、分類)不用管這張表。
- 整組替換分錄(`updateTransaction` 的 `postings`)跟新增交易用同一套分錄檢查(`validatePostings`)。
- `finance_settings` 的 `v2_retired_at`:第一次在畫面上編輯或刪除交易時寫入,之後 `finance:import-v2` 拒絕執行。讀寫只經過 `ledger/settings.ts`。

## 模組切分(`src/modules/finance/server/`)

- **拆分的標準**:會因為不同的原因改動、依賴外部的東西、可以替換、可以單獨測試,符合任一條就拆。共用同一條不變量(表頭與分錄同一個 transaction、每個幣別加總為零)的東西不拆。
- **模組**:`ledger`(帳本核心,唯一寫入交易的地方;收款人與別名、帳戶群組也在這裡)、`import`、`fx`、`classify`、`recurring`、`tags`(含旅行)、`budgets`、`reports`(含匯出 CSV)、`audit`(稽核)。目前已有 `ledger`、`fx`、`import`、`classify`、`recurring`、`tags`(目前只有查詢)。
- `classify` 只決定不寫入(讀取 + 純函式);週期項目的配對在 `recurring`,`classify` 呼叫它。
- 交易清單的篩選、排序、分頁只在 `ledger/list.ts`(`listTransactions`)定義;要「符合某組條件的交易」的功能(報表、匯出、批量編輯)呼叫它,不另寫一份。篩選條件與網址參數的對應在 `lib/transactions.ts`。
- 對帳單匯入的入口只有 `server/import/prepare.ts`(命令列與 API 都呼叫它);不要在 `tools/` 或 route handler 裡自己解析、合併、算計畫。
- **寫入一律經過 ledger 的函式**;其他模組不直接寫交易相關的表。`reports`、`budgets`、`tags`、`audit` 只讀。
- **帳戶餘額一律經過 `ledger/balances.ts`**(`getAccountBalance`、`getAccountBalances`)。系統帳戶(未分類、未分類收入、手續費、換匯)的 id 一律經過 `ledger/accounts.ts` 的 `getSystemAccounts`,不在別處寫名稱或 id。側欄、群組合計、淨值、可動用資金、信用卡可用餘額、報表都呼叫它,不自己寫分錄加總。原因:之後投資帳戶的市值是「持股 × 價格」,股價變動不產生分錄,屆時只改這個函式。
- **fx 要能直接搬到平台層**:不匯入 finance 的其他程式、只透過公開函式(取匯率、換算、更新)使用、匯率表不跟其他表互相參照。要抓哪些幣別、從哪天開始,由 `tools/` 查好傳進去。來源轉接(`frankfurter.ts`)與查詢 / 換算 / 寫入(`index.ts`)分開,換來源只換前者。`convert` 回傳目標幣別最小單位的浮點數,多筆先加總再取整數。
- **audit 與驗證工具不共用被驗證的實作**:`tools/verify-import.ts` 不匯入其他程式,直接比對資料庫;管線行為改了,驗證要用另一種算法跟著改,不能複製實作。

## 對帳單解析(`packages/statement-parsers/`)

- npm workspaces 的套件 `@personal-tools/statement-parsers`;套件自己的規則在 `packages/statement-parsers/CLAUDE.md`,動它之前先讀。目前的來源:Wise CSV。
- 全部是純函式,沒有依賴。內容:各來源解析器、統一的「待匯入交易」型別、來源偵測、去重 key(有來源 ID 用 ID,沒有用 日期 + 金額 + 幣別)。
- 套件輸出的金額是十進位字串、帳戶是來源自己的代號(例:`wise:EUR`)。換成最小貨幣單位的整數(用 `finance_currencies.exponent`)、對應到帳本的帳戶與收款人,在 finance 的 `import` 模組做。
- 預覽確認、比對既有交易、寫入留在 finance(經過 ledger)。

## 收據解析(`packages/receipt-parsers/`)

- npm workspaces 的套件 `@personal-tools/receipt-parsers`;套件自己的規則在 `packages/receipt-parsers/CLAUDE.md`,動它之前先讀。目前的來源:比利時 Lidl(網站匯出的 JSON,明細是 HTML)、比利時 AH(app 匯出的 JSON)。
- 跟 `statement-parsers` 互不匯入。全部是純函式、沒有依賴;輸出統一的收據(總額、付款、依收據順序的品項與折扣行、`balanced`),金額是十進位字串。
- 折扣不分攤到品項、押金不特別處理;配對交易、品項分類、寫入帳本都在 finance 做(還沒做)。

## 測試與資料

- 測試資料與範例設定用虛構的名稱與數字;程式碼、註解、範本裡不可出現真實的對象名稱、金額、日期、帳戶餘額。
- 新加入 repo 的檔案,commit 前先掃描有沒有真實的對象名稱、金額、日期。
