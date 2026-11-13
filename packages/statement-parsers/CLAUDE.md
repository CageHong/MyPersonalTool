# statement-parsers(對帳單解析)

`@personal-tools/statement-parsers`:把銀行 / 支付服務匯出的對帳單檔案解析成統一的「待匯入交易」。目前的來源:Wise 交易紀錄 CSV。使用端是 finance;平台規則在根目錄的 `CLAUDE.md`,finance 的規則在 `.claude/rules/finance.md`。

## 邊界

- **全部是純函式**:輸入是檔案內容(字串),輸出是資料。不讀寫檔案、不碰資料庫、不連網路、不讀時鐘。
- **零依賴**:`package.json` 沒有 `dependencies`。要加依賴先問。
- **不匯入 `src/` 的任何東西**(模組、平台都不行)。使用端從套件名稱 `@personal-tools/statement-parsers` 匯入,只用 `src/index.ts` 匯出的東西,不匯入套件內部的檔案。
- **不知道帳本**:不知道帳本的帳戶 id、收款人 id、分類、幣別的小數位數。帳戶用來源自己的代號(例:`wise:EUR`);對應到帳本、比對既有交易、預覽、寫入都是使用端的事。
- 沒有建置步驟:`exports` 直接指向 `src/index.ts`。Next.js 的程式第一次匯入這個套件時,要在 `next.config.ts` 的 `transpilePackages` 加上套件名稱。

## 金額

- 金額一律是**十進位字串**(例:`"12.30"`),原樣取自來源,不轉成浮點數,也不換成最小貨幣單位。換成整數由使用端依它自己的幣別小數位數做(小數位數只在使用端的資料庫定義一次)。
- `movements` 的金額帶正負號:正 = 流入該帳戶,負 = 流出。**不含手續費**。
- `fee` 是在 `movements` 之外、另外從 `fee.account` 扣掉的金額,正數。
- 字串的檢查與比較用 `src/decimal.ts`,不用 `Number()`、`parseFloat()`。

## 解析結果

- 型別定義在 `src/types.ts`,是這個套件對外的契約;改欄位的意義屬於高風險。
- 個別的列有問題(狀態不是已完成、金額或日期不合法、欄位數不對)時**不丟錯誤、也不默默丟掉**:放進 `skipped`,附行號、原因、原始欄位。使用端要能顯示「略過幾筆、為什麼」。
- 整份檔案無法解析(引號沒結束、缺必要欄位)時丟 `StatementFormatError`。
- 每筆交易的 `raw` 保留那一列所有欄位的原文,不修剪、不改名。
- 時間輸出 UTC 的 ISO 8601,格式固定 `YYYY-MM-DDTHH:MM:SS+00:00`。
- 不認得的狀態或方向一律略過(放進 `skipped`),不猜。

## Wise CSV(`src/wise.ts`)

- 只收 `COMPLETED`;`REFUNDED` 只收方向是 `IN` 的那一列。
- `OUT`:金額與幣別讀 Source,對象讀 `Target name`,手續費讀 Source fee。
- `IN`:金額與幣別讀 **Target**(實際入帳的金額),對象讀 **`Source name`**(匯款人;`Target name` 是帳戶持有人自己)。手續費是匯款人在 Wise 之外付的,`fee` 是 `null`。
- `NEUTRAL`(換匯):一列一筆交易,`movements` 兩筆(先流出、後流入);`externalId` 是 Wise 的 ID,不加後綴。
- 金額欄是「扣掉手續費之後」的數字,手續費另外從來源帳戶扣。
- `Note`(使用者在 Wise 寫的備註)有這一欄就讀進 `note`;不是必要欄位。`Finished on`、`Target fee amount`、`Target fee currency`、`Batch`、`Created by` 不解讀,只留在 `raw`。

## 新增來源

1. `src/<來源>.ts`:一個判斷欄位名的函式 + 一個解析函式,回傳 `ParseResult`。
2. `StatementSource`(`src/types.ts`)加一個值;`src/detect.ts` 的 `PARSERS` 加一項。
3. 測試放在旁邊(`<來源>.test.ts`)。

## 測試

- `npm test`(repo 根目錄)會一起跑 `packages/*/src/**/*.test.ts`。
- 測試資料全部虛構:名稱、金額、日期、ID 都不可以取自真實的對帳單。`src/testing.ts` 是組測試用 CSV 的輔助函式,不從 `index.ts` 匯出。
