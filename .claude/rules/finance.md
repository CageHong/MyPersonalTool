---
paths:
  - "src/modules/finance/**"
  - "src/app/finance/**"
  - "src/app/api/finance/**"
  - "packages/statement-parsers/**"
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
- `src/modules/finance/tools/`:命令列工具(從 v2 匯入、匯入驗證、匯率更新)
- `src/modules/finance/config.example/`:設定檔範例;新增設定欄位時同步更新
- 指令(repo 根目錄):`finance:import-v2`(要設 `PACR_DATA_DIR`,或把 v2 的 `finance.db` 路徑當參數)、`finance:fx-update`、`finance:db:generate`、`finance:db:migrate`

## 資料模型

- `src/modules/finance/db/schema.ts` 是資料模型的唯一定義;改完跑 `npm run finance:db:generate`,不要手改產生出來的 migration。Drizzle Kit 產生不出來的東西(trigger、含運算式的索引)寫在手寫 migration。
- 表名一律 `finance_` 前綴 + 複數;Drizzle 的變數名是「`finance` + 複數」(例:`financeSettings`)。
- 金額一律是最小貨幣單位的整數;正 = 借、負 = 貸。不要引入浮點金額欄位。
- 時間存 UTC 的 ISO 8601 文字,只在顯示時轉時區(tasks 用 Unix 秒;finance 不跟著改)。
- 分類是帳戶(`expense` / `income`),交易上不加 category 欄位。標籤掛在交易上。
- 先付出去、之後會回來的錢(保證金、代墊)記在資產帳戶,不記成支出;收回時沖減該帳戶。
- 「之後」的功能(貸款明細、持股、標的、價格歷史)不預先建表,用到時再加 migration。

## 寫入規則

- 任何寫入交易的程式:表頭與分錄包在同一個 DB transaction,提交前確認每個幣別加總為零。
- 自動分類只補未分類的交易,不覆蓋使用者給過的分類。
- 針對個別交易的人工更正(拆分、收回、轉帳到自己的帳戶、對帳調整)是 ledger 的編輯操作,不靠設定檔。

## 模組切分(`src/modules/finance/server/`)

- **拆分的標準**:會因為不同的原因改動、依賴外部的東西、可以替換、可以單獨測試,符合任一條就拆。共用同一條不變量(表頭與分錄同一個 transaction、每個幣別加總為零)的東西不拆。
- **模組**:`ledger`(帳本核心,唯一寫入交易的地方;收款人與別名、帳戶群組也在這裡)、`import`、`fx`、`classify`、`recurring`、`tags`(含旅行)、`budgets`、`reports`(含匯出 CSV)、`audit`(稽核)。目前已有 `ledger`、`fx`。
- **寫入一律經過 ledger 的函式**;其他模組不直接寫交易相關的表。`reports`、`budgets`、`tags`、`audit` 只讀。
- **帳戶餘額一律經過 `ledger/balances.ts`**(`getAccountBalance`、`getAccountBalances`)。側欄、群組合計、淨值、可動用資金、信用卡可用餘額、報表都呼叫它,不自己寫分錄加總。原因:之後投資帳戶的市值是「持股 × 價格」,股價變動不產生分錄,屆時只改這個函式。
- **fx 要能直接搬到平台層**:不匯入 finance 的其他程式、只透過公開函式(取匯率、換算、更新)使用、匯率表不跟其他表互相參照。要抓哪些幣別、從哪天開始,由 `tools/` 查好傳進去。來源轉接(`frankfurter.ts`)與查詢 / 換算 / 寫入(`index.ts`)分開,換來源只換前者。`convert` 回傳目標幣別最小單位的浮點數,多筆先加總再取整數。
- **audit 與驗證工具不共用被驗證的實作**:`tools/verify-import.ts` 不匯入其他程式,直接比對資料庫;管線行為改了,驗證要用另一種算法跟著改,不能複製實作。

## 對帳單解析(`packages/statement-parsers/`)

- npm workspaces 的套件,還沒建(里程碑 b 的第一項)。
- 全部是純函式,依賴裡沒有資料庫套件。內容:各來源解析器、統一的「待匯入交易」型別、來源偵測、去重 key(有來源 ID 用 ID,沒有用 日期 + 金額 + 幣別)。
- 預覽確認、比對既有交易、寫入留在 finance(經過 ledger)。

## 測試與資料

- 測試資料與範例設定用虛構的名稱與數字;程式碼、註解、範本裡不可出現真實的對象名稱、金額、日期、帳戶餘額。
- 新加入 repo 的檔案,commit 前先掃描有沒有真實的對象名稱、金額、日期。
