# finance:對帳單匯入

描述目前的行為;跟程式碼不一致時以程式碼為準。規則在 `.claude/rules/finance.md`。

## 流程

```
對帳單檔案
  └─ packages/statement-parsers   parseStatement → 待匯入交易(金額是十進位字串、帳戶是來源的代號)+ 略過的列
       └─ server/import  planImport   → 匯入計畫(只讀)
            └─ server/import  applyImport → 經過 ledger 寫入
```

命令列:`npm run finance:import-statement -- <檔案> [--apply]`。不加 `--apply` 是試跑,只印報告。套用前把資料庫複製到 `finance.db.before-import`(每次覆蓋)。

## 待匯入交易 → 分錄(`server/import/draft.ts`)

| 種類 | 分錄 |
|---|---|
| 付出 | 來源帳戶 −(金額 + 手續費);未分類 + 金額;手續費 + 手續費 |
| 入帳 | 來源帳戶 + 金額;未分類收入 − 金額 |
| 換匯 | 流出的帳戶 −(金額 + 手續費);換匯 + 流出金額;換匯 − 流入金額;流入的帳戶 + 流入金額;手續費 + 手續費 |

- 來源的帳戶代號對到帳戶的 `legacy_id`:`wise:EUR` → `WISE_EUR`。帳本沒有對應的帳戶時,那一列列為「無法處理」,不自動建帳戶。
- 十進位字串用 `finance_currencies.exponent` 換成整數;小數位數超過時列為「無法處理」,不四捨五入。
- 對象的原始文字:對方的名稱,沒有就用備註欄(Reference);經過 `ledger/payees.ts` 的 `resolvePayee` 對到收款人。後綴清單目前讀 `<資料夾>/finance/import-v2.json` 的 `payeeSuffixes`。
- `import_meta`:`payee_original`、`source_category`、`row`(那一列所有欄位的原文)。
- 分類一律先進「未分類」/「未分類收入」。

## 匯入計畫(`planImport`)

用來源的 ID(`external_id`)比對帳本:

| 狀態 | 條件 | 套用時 |
|---|---|---|
| 新的 | 帳本沒有這個 ID | 新增交易 |
| 已經有的 | 帳本有這個 ID | 不覆蓋 |
| └ 要補對象 | 入帳;帳本現在的對象等於那一列的 `Target name`(帳戶持有人);檔案裡的匯款人不是持有人 | 對象換成匯款人,其他不動 |
| └ 金額不同 | 來源帳戶那一側(每個帳戶的合計)跟檔案算出來的不同 | 只列在報告,不改 |
| 無法處理 | 沒有 ID、檔案裡 ID 重複、沒有對應的帳戶或幣別、小數位數不對 | 有任何一筆就整份不能套用 |

另外回報:略過的列(解析器給的原因)、帳本有而檔案沒有的筆數。

套用包在一個 DB transaction:任何一筆失敗,整份不寫。同一份檔案套用兩次,第二次不寫任何東西。
