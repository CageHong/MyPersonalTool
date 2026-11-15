# receipt-parsers(收據解析)

`@personal-tools/receipt-parsers`:把超市匯出的收據檔(JSON)解析成統一的「收據」資料。目前的來源:比利時 Lidl(`lidl_be`)與比利時 Albert Heijn(`ah_be`)。只做解析,不配對交易、不分類、不碰資料庫。

## 邊界

- **全部是純函式**:輸入是已經 `JSON.parse` 過的 `unknown`,輸出是資料。不讀寫檔案、不碰資料庫、不連網路、不讀時鐘。
- **零依賴**:`package.json` 沒有 `dependencies`。不匯入 `src/`,也不匯入 `packages/statement-parsers/`。
- **只從 `src/index.ts` 匯出**:使用端從套件名稱 `@personal-tools/receipt-parsers` 匯入,不匯入套件內部的檔案。
- 沒有建置步驟:`exports` 直接指向 `src/index.ts`。Next.js 的程式第一次匯入這個套件時,要在 `next.config.ts` 的 `transpilePackages` 加上套件名稱。

## 金額與時間

- 金額一律是**十進位字串**(例:`"1.40"`、`"-0.50"`),小數點是 `.`,固定兩位小數。
- 字串的檢查、加總與比較用 `src/decimal.ts`(以 `bigint` 分為單位運算),不用浮點數做加總,不換成最小貨幣單位。
- **折扣不分攤到品項**:折扣是獨立的一行,維持在收據上的順序(`position` 從 1 起,品項與折扣共用同一序列)。
- 時間輸出 UTC,格式固定 `YYYY-MM-DDTHH:MM:SS+00:00`。

## 解析結果與型別

- 型別定義在 `src/types.ts`,是對外的契約。
- 單張收據有問題(`deleted`、`missing_detail`、`invalid_amount`、`invalid_date`、`malformed`)時**不丟錯誤、也不默默丟掉**:放進 `skipped`,附 `externalId`、`reason`、`detail`。
- 品項與折扣金額加總不等於總額時照樣輸出,`balanced: false`。
- 整個檔案形狀不對(不是物件、缺 `tickets` / `receipts` 陣列,或 `parseReceipts` 認不出格式)時丟 `ReceiptFormatError`。
- 每張收據的 `raw` 原樣保留來源檔裡的原始物件。

## Lidl BE(`src/lidl.ts`)

- 只讀 `tickets[].ticket`(不使用 `summaries`);`isDeleted: true` → `skipped`(`deleted`),缺 `htmlPrintedReceipt` → `skipped`(`missing_detail`)。
- `ticket.totalAmount` 不可信,總額讀 HTML `purchase_summary` 裡的 `data-receipt-total`。
- `ticket.date` 無時區,視為 `Europe/Brussels` 當地時間,透過 `Intl.DateTimeFormat` 換算 UTC(含夏令時間)。
- `payments` 讀 `data-tender-description` 屬性的 span,屬性值為付款方式,文字最後的數字為金額。
- 明細在 `<span class="purchase_list">` 與 `<span class="purchase_summary">` 之間,屬性與文字皆做 HTML entity 解碼:
  - `class="article"`:結尾為「金額 + 空白 + 大寫字母(稅別)」才是品項;無結尾金額的續行(如秤重明細第二行)略過。有小數的 `data-art-quantity` 為 `kg`,其餘 `piece`。
  - `class="discount"`,或無 `class` 且結尾為負數的 span:折扣,`data-promotion-id` 空字串轉成 `null`。
  - `class="currency"` 略過;`purchase_summary` 的件數與節省金額不計入明細或總額。

## Albert Heijn BE(`src/ah.ts`)

- 時間與總額在 `summaries`,明細在 `receipts`,以 `id` 配對;單邊缺席皆進 `skipped`(`missing_detail`)。
- `dateTime` 為 UTC ISO 8601,轉成固定格式。
- 金額從數字轉兩位小數字串(`toFixed(2)`),轉回數字不等於原值(超過兩位小數)→ `skipped`(`invalid_amount`)。
- `products` 之後接著 `discounts`(`discounts: null` 視為無折扣),不將折扣綁定到品項。`unit` 一律 `piece`,`taxCode` 與 `store` 為 `null`。

## 新增來源

1. `src/<來源>.ts`:一個形狀判斷函式 + 一個解析函式,回傳 `ReceiptParseResult`。
2. `ReceiptSource`(`src/types.ts`)加一個值;`src/detect.ts` 的 `PARSERS` 加一項。
3. 測試放在旁邊(`<來源>.test.ts`)。

## 測試

- `npm test`(repo 根目錄)會一起跑 `packages/*/src/**/*.test.ts`。
- 測試資料全部虛構:名稱、金額、日期、ID 都不可以取自真實的收據。
