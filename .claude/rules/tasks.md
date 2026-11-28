---
paths:
  - "src/modules/tasks/**"
  - "src/app/tasks/**"
  - "src/app/api/tasks/**"
---

# tasks(任務管理)

個人任務管理系統。平台規則在根目錄的 `CLAUDE.md`(錯誤契約、樣式、風險分級、紀律都在那裡);本檔只放 tasks 自己的規則。

## 文件

| 要動什麼 | 先讀 |
|---|---|
| schema、migration、欄位語意、時間處理、伺服器端計算 | `docs/tasks/data-model.md` |
| 新增或修改 API、回傳順序 | `docs/tasks/api.md` |
| 三欄版面、網址狀態、欄位儲存、焦點、過場、分組排序置頂的 UI、批次貼上 | `docs/tasks/ui/layout.md` |
| checklist | `docs/tasks/ui/checklist.md` |
| 重複任務、日期選單 | `docs/tasks/ui/recurrence.md` |
| 習慣 | `docs/tasks/ui/habits.md` |
| 某條規則「為什麼這樣定」 | `docs/tasks/decisions.md`(平台層級的在 `docs/platform/decisions.md`) |
| 還沒做的事、已知問題、開發順序 | `docs/tasks/backlog.md` |

## MVP 範圍

只做:任務的建立、列出、勾完成、刪除,資料存進 SQLite,重開瀏覽器還在。

明確**不做**(提出前先問我):積分系統、Google Calendar 同步。平台層級不做的事見根目錄的 `CLAUDE.md`。

## 位置

- 頁面:`src/app/tasks/`(網址 `/tasks`)
- route handler:`src/app/api/tasks/`;任務本身是 `/api/tasks/tasks`
- 資料庫:`<資料夾>/tasks/tasks.db`,位置只在 `src/modules/tasks/db/path.ts` 定義
- 錯誤類別:`src/modules/tasks/server/`;錯誤代碼轉中文:`src/modules/tasks/lib/errors.ts`
- migration:`npm run tasks:db:generate`

## 前端

**資料一律走 HTTP。** 畫面用 Client Component,以 `fetch('/api/tasks/tasks')` 取資料。不要在頁面或元件直接 import `src/modules/tasks/server/`(型別也不行),不要用 Server Action。理由見 `docs/tasks/decisions.md` §4。

**畫面更新一律重新抓。** 任何寫入操作(POST / PATCH / DELETE)成功後,重新 `GET /api/tasks/tasks`,用回傳結果整份替換 state。不要拿回應的物件去局部更新 state,不要做樂觀更新。習慣的寫入同理,重抓的是 `GET /api/tasks/habits`。例外只有三個,都已定案,不要再增加:編輯中的輸入框、checklist 拖曳排序、習慣計數。

**寫入不停用控制項。** 任務與 checklist 的寫入都經過佇列,每個動作等前一個(含重抓)完成才開始,期間**不**用 `disabled` 或 `readOnly` 擋控制項(例外:ConfirmDialog 的確認鈕);防重複送出用 ref(如 `pendingRef`)。理由見 `docs/tasks/decisions.md` §5。

**停用樣式一律延遲顯示。** 擋住操作的狀態(disabled、readOnly)的外觀,變化都要延遲 `--disabled-delay` 才發生,回到啟用狀態時立即恢復。目前適用:ConfirmDialog 的確認鈕。理由見 `docs/tasks/decisions.md` §4。

**錯誤訊息一律中文。** 錯誤代碼在 `src/modules/tasks/lib/errors.ts` 轉成中文,對應不到的代碼也要有中文 fallback,不要把 API 的英文訊息漏到畫面上。

## 介面架構(概要)

三欄版面(左到右):分類欄(智慧檢視,決定中欄顯示哪些任務)、任務清單(頂端新增列 + 任務列)、編輯欄(被選取的任務)。另有習慣視圖(`view=habits`),中欄與右欄整組換掉。

**選取狀態放在網址**(`?view=today&task=123`),不要用元件內的 state 存。**每個欄位各自儲存,各自送一次 PATCH。**

其餘(儲存時機表、寫入佇列與焦點遞補、過場、對話框關閉路徑)見 `docs/tasks/ui/layout.md`。

## 之後才做(現在不要提出實作)

自訂清單、標籤、目標(goal)、子任務 UI、清單動態、習慣的回顧視圖與格子圖(H3)、排程視圖(C1–C3)、批量選取與刪除。

細節與開發順序見 `docs/tasks/backlog.md`,決策見 `docs/tasks/decisions.md` §6c、§6e。
