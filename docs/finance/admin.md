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
