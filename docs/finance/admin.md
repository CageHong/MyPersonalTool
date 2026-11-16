# 管理頁

分類、收款人、規則、標籤、帳戶的管理。畫面在 `/finance/<名稱>`(側欄「管理」底下),左邊清單、右邊選中項目的面板。
所有寫入都經過 `server/` 的函式、包在一個 DB transaction,並寫入 `finance_settings` 的 `v2_retired_at`
(`finance:import-v2` 重建資料庫會洗掉這些修改)。API 的錯誤原因代碼對到畫面訊息的表在 `lib/api.ts` 的 `adminErrorMessage`。

## 分類

程式在 `server/ledger/categories.ts`,請求的形狀在 `lib/categories.ts`。

| API | 作用 |
|---|---|
| `GET /api/finance/categories` | 全部分類:上層後面接子分類(各自依 `sort_order`、`id`),附交易筆數、規則數、週期項目數 |
| `POST /api/finance/categories` | 新增 `{ name, type, parentId }`;排在同一層最後 |
| `PATCH /api/finance/categories/<id>` | 改名、換上層(`null` = 最上層)、封存(`isActive`) |
| `POST /api/finance/categories/<id>/move` | `{ direction: 'up' \| 'down' }`,同一層裡移一格 |
| `POST /api/finance/categories/<id>/merge` | `{ targetId }`:分錄、規則、週期項目改指向目標,再刪掉這個 |
| `DELETE /api/finance/categories/<id>` | 刪除 |

規則:

- 系統分類(未分類、未分類收入、手續費)不能改名、換上層、封存、合併掉、刪除;可以當合併的目標。
- 類型(支出 / 收入)不能改;合併的目標要同類型。
- 只有兩層:上層必須是同類型的最上層、不是系統分類;本身有子分類的不能放到別人底下;有子分類的不能被合併(先把子分類移走或合併)。
- 同類型、同一層名稱不能重複。
- 刪除:有交易、有子分類、被規則或週期項目用到都不行;用合併把它們一起改指過去,或封存。
- 封存:新交易的選單選不到(交易的編輯面板、新增交易),舊資料照常顯示。
- 顏色不在這裡(分類色到里程碑 c 才指派)。

## 收款人

程式在 `server/ledger/payees.ts`(跟匯入的比對、建立在同一個檔),回傳的形狀在 `lib/payees.ts`。

| API | 作用 |
|---|---|
| `GET /api/finance/payees` | 全部收款人:交易筆數、別名、規則數、週期項目數,依名稱排序 |
| `PATCH /api/finance/payees/<id>` | 改名 `{ name }`(不能重複) |
| `POST /api/finance/payees/<id>/merge` | `{ targetId }`:交易、別名、規則、週期項目改指向目標,再刪掉這個 |
| `DELETE /api/finance/payees/<id>` | 刪除(別名一起刪);有交易、規則、週期項目用到時不行 |
| `PATCH /api/finance/payees/aliases` | `{ alias, payeeId }`:別名移到另一個收款人 |
| `DELETE /api/finance/payees/aliases` | `{ alias }`:刪除別名 |

- 別名是匯入時的比對鍵(正規化後的文字);移動或刪除別名只影響之後的匯入,已經匯入的交易不動。刪掉別名後,那個寫法下次匯入時重新比對(找同名的收款人,沒有就新增)。
- 合併取代了 `import-v2.json` 的 `payeeMerges`(v2 停用後那份設定不再套用)。
- 畫面不能新增別名;同一個對象的新寫法,匯入後用合併處理。
- 清單的排序在畫面上做(`lib/payees.ts` 的 `sortPayees`),網址參數 `sort`:省略 = 名稱(不分大小寫),`count` = 交易筆數由多到少、同筆數依名稱。

## 規則

程式在 `server/classify/rules.ts`(決定分類的 `classify/index.ts` 只讀規則;規則的寫入只在這裡),形狀在 `lib/rules.ts`。
規則怎麼被用見 `docs/finance/classify.md`。

| API | 作用 |
|---|---|
| `GET /api/finance/rules` | 全部規則,依種類、`priority`、`id` |
| `POST /api/finance/rules` | 新增 `{ matchField, payeeId \| matchValue, assignAccountId, isActive }`;排在同一種最後 |
| `PATCH /api/finance/rules/<id>` | 改收款人 / 來源分類文字(只能改同一種的)、分類、啟用 |
| `POST /api/finance/rules/<id>/move` | 同一種裡上移、下移(重新編成 0、1、2…) |
| `DELETE /api/finance/rules/<id>` | 刪除 |
| `GET /api/finance/rules/reclassify` | 重新分類的預覽:每一筆未分類的交易會被分到哪裡、沒命中的筆數 |
| `POST /api/finance/rules/reclassify` | `{ transactionIds }`:只寫入選中的;寫入前用最新的資料重算,已經不是未分類的跳過 |

- 對象規則只能指到支出分類(只用在付出);來源分類規則可以指到支出或收入分類。
- 規則的「自動加標籤」(`assign_tags`)畫面不顯示,自動分類也不用。
- 重新分類只動還記在「未分類」/「未分類收入」的交易:那條分錄換到決定的分類,`category_source` 記決定的來源(`scheduled`、`rule`、`payee_history`、`source_category`),配對到週期項目時一起記下。寫入經過 `ledger/transactions.ts` 的 `assignCategory`。

## 標籤

程式在 `server/tags/index.ts`(標籤本身);交易身上的標籤經過 `ledger/transactions.ts`(`tagTransactions`、`moveTagLinks`、`updateTransaction`)。形狀在 `lib/tags.ts`。

| API | 作用 |
|---|---|
| `GET /api/finance/tags` | 全部標籤,附交易筆數,依名稱排序 |
| `POST /api/finance/tags` | 新增 `{ name, startsOn?, endsOn? }` |
| `PATCH /api/finance/tags/<id>` | 改名、日期範圍(`null` = 一般標籤) |
| `POST /api/finance/tags/<id>/merge` | `{ targetId }`:這個標籤的交易都加上目標標籤(已經有的不重複),再刪掉這個 |
| `DELETE /api/finance/tags/<id>` | 刪除;交易上的這個標籤由外鍵 cascade 一起拿掉 |
| `GET /api/finance/tags/<id>/range` | 旅行標籤:範圍內、還沒有這個標籤的交易(預覽) |
| `POST /api/finance/tags/<id>/range` | `{ transactionIds }`:選中的加上標籤;不在範圍內的不加 |

- 名稱不能重複;日期範圍要成對,最後一天不早於第一天。範圍以 UTC 切日比對 `occurred_at`(跟交易清單的日期篩選相同)。
- 日期範圍只是「加標籤」的線索:不會自動套用到新交易,邊緣的交易(出發前、回來後)在預覽裡取消勾選即可。

## 帳戶(資產 / 負債)

程式在 `server/ledger/balance-accounts.ts`,形狀與子類型清單在 `lib/balance-accounts.ts`。餘額經過 `ledger/balances.ts`。

| API | 作用 |
|---|---|
| `GET /api/finance/accounts` | 全部資產、負債帳戶:子類型、幣別、餘額、交易筆數 |
| `POST /api/finance/accounts` | 新增 `{ name, type, subtype, currency }` |
| `PATCH /api/finance/accounts/<id>` | 改名、子類型、封存 |

- 子類型:資產 `bank`、`cash`、`broker`、`receivable`(代墊款)、`deposit`(保證金)、`prepaid`;負債 `credit_card`、`loan`。
- 幣別建立後不能改(有固定幣別的帳戶,分錄幣別要一致)。同類型、最上層名稱不能重複。
- 封存:新增交易、分錄編輯的帳戶選單選不到;舊交易照常。刪除帳戶、群組、信用卡明細在里程碑 c。

## 刪掉過的匯入交易

在匯入頁下方(`components/DeletedImports.tsx`)。程式在 `ledger/transactions.ts`(`listDeletedImports`、`forgetDeletedImport`)。

| API | 作用 |
|---|---|
| `GET /api/finance/import/deleted` | `finance_deleted_external_ids` 的清單,附刪除當時的日期、對象、金額(取自快照) |
| `DELETE /api/finance/import/deleted` | `{ externalId }`:取消刪除;下次匯入同一份檔案時這筆會重新加進來(用來源的內容,刪除前做過的修改不會回來) |
