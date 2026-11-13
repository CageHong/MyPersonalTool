@AGENTS.md

# tasks

個人任務管理系統。這是「personal-tools」平台的第一個工具,之後會有 media tracker、Fog of World 整合、PACR(複式簿記記帳)並存。

## 文件分工

本檔只放**動手之前必須先知道、否則會做錯的規則與契約**。會隨程式碼變動的描述(欄位表、端點表、各功能的互動細節)拆在 `docs/`,動到對應區域時才讀。

| 要動什麼 | 先讀 |
|---|---|
| schema、migration、欄位語意、時間處理、伺服器端計算 | `docs/data-model.md` |
| 新增或修改 API、回傳順序 | `docs/api.md` |
| 三欄版面、網址狀態、欄位儲存、焦點、過場、分組排序置頂的 UI、批次貼上 | `docs/ui/layout.md` |
| checklist | `docs/ui/checklist.md` |
| 重複任務、日期選單 | `docs/ui/recurrence.md` |
| 習慣 | `docs/ui/habits.md` |
| 某條規則「為什麼這樣定」 | `docs/decisions.md` |
| 還沒做的事、已知問題、開發順序 | `docs/backlog.md` |

已定案的決策與理由記錄在 `docs/decisions.md`。規則衝突時以 `decisions.md` 較新的條目為準;需要推翻其中任何一條時,先停下來問,不要自行改。

`docs/` 底下的描述性內容與程式碼不一致時以程式碼為準,並在同一次修改裡更新文件。

## MVP 範圍

只做:任務的建立、列出、勾完成、刪除,資料存進 SQLite,重開瀏覽器還在。

明確**不做**(提出前先問我):積分系統、Google Calendar 同步、共用設計系統、首頁 shell、使用者帳號、部署設定。

## 技術棧

- Next.js App Router + TypeScript
- Drizzle ORM + better-sqlite3
- CSS Modules + CSS 變數(**不用 Tailwind**)

Next.js 的正確寫法一律查 `node_modules/next/dist/docs/01-app/`。
`02-pages/` 是舊的 Pages Router,本專案不使用,不要參考。

## 目錄結構

- `src/app/tasks/` — 頁面(網址 `/tasks`;根路徑 `/` 只轉址到這裡)
- `src/app/api/tasks/` — route handler(網址一律以 `/api/tasks/` 開頭,任務本身是 `/api/tasks/tasks`)
- `src/app/api/_lib/` — route handler 共用的 HTTP 輔助函式
- `src/modules/tasks/server/` — 業務邏輯(純函式)
- `src/modules/tasks/db/` — Drizzle schema 與連線
- `src/modules/tasks/components/` — UI 元件
- `src/modules/tasks/lib/` — 前後端共用的純函式與型別(不碰資料庫與檔案系統)
- `src/modules/tasks/drizzle/` — migration 檔(進版控);設定在 `src/modules/tasks/drizzle.config.ts`,用 `npm run tasks:db:generate` 產生
- `src/platform/` — 各工具共用、不屬於任何一個工具的程式(目前只有資料夾位置 `dataDir.ts`)
- 資料庫不在 repo 裡:`<資料夾>/tasks/tasks.db`,資料夾由 `PERSONAL_TOOLS_DATA_DIR` 指定,預設是 repo 旁邊的 `personal-tools-data/`

## 錯誤與驗證契約

錯誤回應一律用 HTTP 狀態碼 + 結構化 JSON:

```json
{ "error": { "code": "VALIDATION_FAILED", "message": "...", "fields": { "title": "required" } } }
```

MVP 只有三種錯誤碼,不要自行增加:

| 狀態碼 | code | 用在 |
|---|---|---|
| 400 | `VALIDATION_FAILED` | 輸入不合法,附 `fields` |
| 404 | `NOT_FOUND` | 指定 id 不存在 |
| 500 | `INTERNAL_ERROR` | 其他所有情況 |

**不要**用「一律回 200,錯誤放 body」的做法。

驗證的位置:

- 驗證邏輯寫在 `src/modules/tasks/server/` 的函式裡,不寫在 route handler(理由見 `docs/decisions.md` §1)。
- 驗證失敗時 throw 自訂錯誤類別(帶 `fields` 資訊),定義在 `src/modules/tasks/server/`。
- route handler 用 `instanceof` 判斷錯誤類別,對映到狀態碼。`src/modules/tasks/server/` 不可以知道 HTTP 的存在——不 import Next.js 的任何東西,不回傳 Response。

驗證 vs 解析的判準:這條規則在**非 HTTP 的呼叫路徑**上還成立嗎?

- 成立(例:title 不能為空)→ 業務驗證,寫在 `src/modules/tasks/server/`
- 不成立(例:網址上的 id 是 "abc"、body 不是合法 JSON)→ 協定層解析,寫在 route handler,同樣回 `VALIDATION_FAILED`

## 前端

**資料一律走 HTTP。** 畫面用 Client Component,以 `fetch('/api/tasks/tasks')` 取資料。不要在頁面或元件直接 import `src/modules/tasks/server/`(型別也不行),不要用 Server Action。理由見 `docs/decisions.md` §4。

**畫面更新一律重新抓。** 任何寫入操作(POST / PATCH / DELETE)成功後,重新 `GET /api/tasks/tasks`,用回傳結果整份替換 state。不要拿回應的物件去局部更新 state,不要做樂觀更新。習慣的寫入同理,重抓的是 `GET /api/tasks/habits`。例外只有三個,都已定案,不要再增加:編輯中的輸入框、checklist 拖曳排序、習慣計數。

**寫入不停用控制項。** 任務與 checklist 的寫入都經過佇列,每個動作等前一個(含重抓)完成才開始,期間**不**用 `disabled` 或 `readOnly` 擋控制項(例外:ConfirmDialog 的確認鈕);防重複送出用 ref(如 `pendingRef`)。理由見 `docs/decisions.md` §5。

**停用樣式一律延遲顯示。** 擋住操作的狀態(disabled、readOnly)的外觀,變化都要延遲 `--disabled-delay` 才發生,回到啟用狀態時立即恢復。目前適用:ConfirmDialog 的確認鈕。理由見 `docs/decisions.md` §4。

**樣式一律 CSS Modules。** 元件的 `.module.css` 不可以寫死顏色、間距、圓角、字級、字重、字型,一律引用 `src/app/globals.css` `:root` 的變數。需要新的值先加進 `:root`,不要在元件裡寫數值。

**CSS 變數分兩層**(理由見 `docs/decisions.md` §7):

- 色票層 `--palette-*`:名字只描述顏色本身,不帶用途。
- 語意層 `--color-*`:名字描述用途,值一律指向色票層。

**元件只能引用語意層**,不得引用 `--palette-*`。需要新顏色時先看語意層有沒有合適的名字;沒有就新增語意變數指向既有色票,新增色票要先問。間距只能用 `--space-1` 到 `--space-5`,字級只能用 `--text-xs` 到 `--text-lg`。過場的時長與曲線只能用 `--motion-duration`、`--motion-easing`。

**錯誤訊息一律中文。** 錯誤代碼在 `src/modules/tasks/lib/errors.ts` 轉成中文,對應不到的代碼也要有中文 fallback,不要把 API 的英文訊息漏到畫面上。

現階段不做深色模式,不做共用設計系統。

## 介面架構(概要)

三欄版面(左到右):分類欄(智慧檢視,決定中欄顯示哪些任務)、任務清單(頂端新增列 + 任務列)、編輯欄(被選取的任務)。另有習慣視圖(`view=habits`),中欄與右欄整組換掉。

**選取狀態放在網址**(`?view=today&task=123`),不要用元件內的 state 存。**每個欄位各自儲存,各自送一次 PATCH。**

其餘(儲存時機表、寫入佇列與焦點遞補、過場、對話框關閉路徑)見 `docs/ui/layout.md`。

## 之後才做(現在不要提出實作)

自訂清單、標籤、目標(goal)、子任務 UI、習慣的回顧視圖與格子圖(H3)、排程視圖(C1–C3)、批量選取與刪除。

細節與開發順序見 `docs/backlog.md`,決策見 `docs/decisions.md` §6c、§6e。

## 工作流程:依風險分級

指令會標明是哪一級。**沒標明時視為高風險。**

**低風險步驟**:只改 CSS 值或變數名稱、刪除沒有引用的程式碼、不改變任何行為。

- 可以直接實作,不必先交計畫。
- 完成後回報:改了哪些檔案、每個檔案改了什麼(一行)、`tsc` 與 `lint` 結果。
- 過程中發現需要改變行為,或範圍超出指令,停下來回報,不要自行擴大。

**高風險步驟**:涉及 state、effect、焦點管理、資料流、API、schema。

- 先列出要改的檔案與做法,等確認再寫。

## 紀律

1. **業務邏輯一律寫在 `src/modules/tasks/server/` 的純函式。** route handler 只做三件事:解析請求、呼叫 `src/modules/tasks/server/` 的函式、回傳 JSON。不要在 route handler 裡寫任何邏輯或直接碰資料庫。理由見 `docs/decisions.md` §1。
2. repo 裡不放任何資料;資料庫的位置只在 `src/modules/tasks/db/path.ts` 定義。`.gitignore` 的 `/data` 只是保險。
3. 一次只做一個垂直切片,結束時必須是跑得起來、可以 commit 的狀態。
4. 改了行為就在同一次修改裡更新對應的 `docs/` 檔;新定案的決策追加到 `docs/decisions.md`。

## 語言

與我對話一律用**繁體中文**。程式碼、變數名、commit message 用英文。
