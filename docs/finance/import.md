# finance:對帳單匯入

描述目前的行為;跟程式碼不一致時以程式碼為準。規則在 `.claude/rules/finance.md`。

## 流程

```
對帳單檔案
  └─ packages/statement-parsers   parseStatement → 待匯入交易(金額是十進位字串、帳戶是來源的代號)+ 略過的列
       └─ server/import  planImport   → 匯入計畫(只讀;新交易的分類由 server/classify 決定)
            └─ server/import  applyImport → 經過 ledger 寫入
```

入口只有一個:`server/import/prepare.ts`。命令列與畫面都呼叫它,不各自解析、合併、算計畫:

| 函式 | 做什麼 |
|---|---|
| `prepareImport` | 檔案文字 → 解析 → 合併 → 匯入計畫(只讀)。沒有檔案、認不出來源、缺欄位、不同來源混在一起是驗證錯誤(`fields.files`,認得出檔案時是帶檔名的說明) |
| `summarizeImport` | 計畫 → 給人看的摘要(`lib/import-summary.ts` 的 `ImportSummary`),含計畫指紋與 `canApply` |
| `previewStatementFiles` | 上面兩步合起來(試跑) |
| `applyStatementFiles` | 重新準備一次 → 檢查 → 備份 → 套用 |

**計畫指紋**:會被寫入的內容(新交易的時間、對象、備註、分錄、分類來源、週期項目;要補的對象)的 SHA-256。試跑與套用之間不存任何狀態:套用時重送同樣的檔案與試跑時的指紋,伺服器重算計畫,指紋不同(帳本在中間變了)就不寫,`fields.fingerprint = 'stale'`。其他擋套用的情況:檔案之間有衝突(`fields.plan = 'conflicts'`)、有無法處理的列(`ImportBlockedError`,`fields.plan = 'blocked'`)。

**備份**:套用前用 `db/backup.ts` 的 `backupDatabase`(SQLite 的 `VACUUM INTO`)寫到 `finance.db.before-import`(位置在 `db/path.ts`,每次覆蓋)。

**選項**:對象的後綴清單由 `server/import/options.ts` 的 `loadImportOptions` 讀(目前是 `import-v2.json` 的 `payeeSuffixes`)。

命令列:`npm run finance:import-statement -- <檔案> [<檔案> …] [--apply]`。不加 `--apply` 是試跑,只印報告(從 `ImportSummary` 印)。

畫面:`/finance/import`。選檔(可以多個)就試跑,顯示報告;「套用」只在 `canApply` 時能按;套用後自動再試跑一次,報告換成帳本現在的狀態。

API(multipart/form-data,檔案的欄位名是 `files`,可以多個;檔案只在請求裡讀,不存到磁碟):

| 端點 | 輸入 | 回傳 |
|---|---|---|
| `POST /api/finance/import/plan` | `files` | `ImportSummary` |
| `POST /api/finance/import/apply` | `files`、`fingerprint` | `ImportResult`(`created`、`payeesFixed`、`backupPath`) |

檔案(一個或多個:分段匯出、期間重疊)先用 `mergeParseResults` 合成一份。同一個 ID 出現在不同檔案時:會影響寫入的內容(種類、時間、金額、手續費、對象;沒有對方名稱時對象是備註欄)不同,列為衝突,都不匯入,有衝突就不能套用;只有 Wise 的備註(Note)或來源分類不同,用第一份檔案的,試跑報告另外列出來給人確認;只差在其他原始欄位的視為相同。同一份檔案裡 ID 重複不在合併時處理:重複的列原樣交給匯入計畫,列為無法處理。

## 待匯入交易 → 分錄(`server/import/draft.ts`)

| 種類 | 分錄 |
|---|---|
| 付出 | 來源帳戶 −(金額 + 手續費);未分類 + 金額;手續費 + 手續費 |
| 入帳 | 來源帳戶 + 金額;未分類收入 − 金額 |
| 換匯 | 流出的帳戶 −(金額 + 手續費);換匯 + 流出金額;換匯 − 流入金額;流入的帳戶 + 流入金額;手續費 + 手續費 |

- 來源的帳戶代號對到帳戶的 `legacy_id`:`wise:EUR` → `WISE_EUR`。帳本沒有對應的帳戶時,那一列列為「無法處理」,不自動建帳戶。
- 十進位字串用 `finance_currencies.exponent` 換成整數;小數位數超過時列為「無法處理」,不四捨五入。
- 對象的原始文字:對方的名稱,沒有就用備註欄(Reference);經過 `ledger/payees.ts` 的 `resolvePayee` 對到收款人。後綴清單目前讀 `<資料夾>/finance/import-v2.json` 的 `payeeSuffixes`。同一個對象的不同寫法靠別名表:目前由 `finance:import-v2` 依同一份設定的 `payeeMerges` 寫入(v2 的資料裡沒出現過的寫法也會建)。
- `import_meta`:`payee_original`、`source_category`、`row`(那一列所有欄位的原文)。
- 草稿的分類一律是「未分類」/「未分類收入」;`planImport` 再用 `server/classify` 決定新交易的分類,把那一側的分錄換成決定的帳戶(換匯不分類)。決定的順序見 `docs/finance/classify.md`。

## 匯入計畫(`planImport`)

用來源的 ID(`external_id`)比對帳本:

| 狀態 | 條件 | 套用時 |
|---|---|---|
| 新的 | 帳本沒有這個 ID | 新增交易,分錄已經套用分類;連同 `category_source`、`scheduled_id` 寫入 |
| 已經有的 | 帳本有這個 ID | 不覆蓋 |
| └ 要補對象 | 入帳;帳本現在的對象等於那一列的 `Target name`(帳戶持有人);檔案裡的匯款人不是持有人(寫法不同、也沒有透過別名對到同一個收款人) | 對象換成匯款人(有別名就用別名指到的收款人),其他不動 |
| └ 金額不同 | 來源帳戶那一側(每個帳戶的合計)跟檔案算出來的不同 | 只列在報告,不改 |
| 無法處理 | 沒有 ID、檔案裡 ID 重複、沒有對應的帳戶或幣別、小數位數不對、金額是零或互相抵銷 | 有任何一筆就整份不能套用 |

另外回報:略過的列(解析器給的原因)、帳本有而檔案沒有的筆數、新交易依分類來源的筆數、週期項目同時符合兩個以上(沒有配對)的交易。

已經在帳本裡的交易不重新分類。

套用包在一個 DB transaction:任何一筆失敗,整份不寫。同一份檔案套用兩次,第二次不寫任何東西。
