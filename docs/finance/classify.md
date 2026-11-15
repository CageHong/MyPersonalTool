# finance:自動分類

描述目前的行為;跟程式碼不一致時以程式碼為準。規則在 `.claude/rules/finance.md`。

## 什麼時候用

只用在新交易:對帳單匯入時,`planImport` 為每一筆新交易決定分類(試跑的報告就看得到),`applyImport` 直接用決定的分類寫入。帳本裡已經有的交易(包括仍未分類的)不會被重新分類。

## 結構

| 位置 | 內容 |
|---|---|
| `server/classify/index.ts` | `loadClassifyContext(db)`:一次讀進規則、週期項目、對象歷史(只讀)。`decide(input, ctx)`:純函式,回傳分類、分類來源、週期項目 |
| `server/recurring/index.ts` | `loadScheduledItems(db)`、`matchScheduled(items, candidate)`:週期項目的配對(純函式) |

## 決定的順序

**付出**(命中就停):

| 順序 | 來源(`category_source`) | 條件 |
|---|---|---|
| 1 | `scheduled` | 收款人相同、幣別相同、金額在範圍內、日期在範圍內(UTC 日期)、項目啟用中;分類那一側只有一個幣別。同時符合兩個以上時不配對、回報,繼續往下 |
| 2 | `rule` | `finance_rules` 有這個收款人的規則(`match_field = payee`;啟用中、有指定分類;多條時取 `priority` 小的,再取 id 小的) |
| 3 | `payee_history` | 同一個收款人,使用者給過的分類(`legacy`、`correction`、`manual`)的借方分錄裡,最多的那個最上層分類佔比 ≥ 80%;記到那個最上層分類底下最常見的實際帳戶(同次數取 id 小的) |
| 4 | `source_category` | `finance_rules` 有這個來源分類的規則(`match_field = source_category`) |
| — | NULL | 都沒有命中:維持「未分類」 |

付出只會被記到支出分類;規則指到別種帳戶時當作沒有命中。

**入帳**:只看來源分類規則。規則指到收入分類就是收入;指到支出分類就是沖銷那個分類的支出(退款、代墊收回)。沒有命中就維持「未分類收入」。

**換匯**:不分類。

## 不做的

- 規則的 `assign_tags`(貼標籤屬於 tags 模組)。
- 收款人還沒出現在帳本時(第一次看到的寫法,而且沒有同名的收款人),只有來源分類規則會命中。
