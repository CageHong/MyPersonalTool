@AGENTS.md

# tasks

個人任務管理系統。這是「personal-tools」平台的第一個工具,之後會有 media tracker、Fog of World 整合、PACR(複式簿記記帳)並存。

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

- `src/app/` — 頁面與路由
- `src/app/api/` — route handler
- `src/server/` — 業務邏輯(純函式)
- `src/db/` — Drizzle schema 與連線
- `src/components/` — UI 元件
- `drizzle/` — migration 檔(進版控)
- `data/` — SQLite 檔(不進版控)


## 資料模型

`task` 表(一列 = 一個具體的任務實例,不是重複規則):

| 欄位 | 型別 | 可空 | 說明 |
|---|---|---|---|
| `id` | integer PK autoincrement | 否 | |
| `title` | text | 否 | |
| `notes` | text | 是 | 描述 |
| `dueDate` | text `YYYY-MM-DD` | 是 | 日曆日,**不是**時間戳 |
| `dueTime` | text `HH:MM` | 是 | 有指定時刻才填 |
| `scheduledAt` | integer (Unix 秒) | 是 | 打算執行的時刻 |
| `durationMinutes` | integer | 是 | 預估長度 |
| `priority` | integer 預設 0 | 否 | |
| `completedAt` | integer (Unix 秒) | 是 | `null` = 未完成 |
| `createdAt` | integer (Unix 秒) | 否 | |
| `parentTaskId` | integer FK → `task.id` | 是 | 子任務;本輪不做 UI |

時間處理規則:

- 絕對瞬間一律存 **Unix 秒數整數**(`createdAt`、`completedAt`、`scheduledAt`)。
- `dueDate` 是**日曆日**,存文字 `YYYY-MM-DD`。不要轉成時間戳——跨時區會偏一天。
- `dueTime` 與 `dueDate` 分開,因為「9/10 到期」和「9/10 15:00 到期」語意不同。
- `durationMinutes` 是長度不是時刻,存分鐘數。
- 完成狀態用 `completedAt` 判斷,**不要**加布林欄位。
- `createdAt` 在 schema 層**沒有**預設值,由 `src/server/` 的建立函式填入 `Math.floor(Date.now() / 1000)`。理由:那是業務規則,不放資料層。

之後才做(現在不要提出實作):

- `recurrence` 表:重複規則(每日/每週/每月),`task` 用 `templateId` 指回。
- `checklist_item` 表:任務底下的待辦項,**不是**任務——沒有截止日、不排程、不出現在任務清單查詢裡。
- 子任務 UI:用既有的 `parentTaskId`。

## API 設計

端點:

| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api/tasks` | 列出全部 |
| POST | `/api/tasks` | 建立 |
| PATCH | `/api/tasks/:id` | 部分更新(含勾完成) |
| DELETE | `/api/tasks/:id` | 刪除 |

用 PATCH 不用 PUT:勾完成只改 `completedAt` 一個欄位,不是整個資源替換。

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

- 驗證邏輯寫在 `src/server/` 的函式裡,不寫在 route handler。理由:純函式是唯一入口,之後從重複任務產生邏輯或匯入 script 呼叫時,驗證不會被繞過。
- 驗證失敗時 throw 自訂錯誤類別(帶 `fields` 資訊),定義在 `src/server/`。
- route handler 用 `instanceof` 判斷錯誤類別,對映到狀態碼。`src/server/` 不可以知道 HTTP 的存在——不 import Next.js 的任何東西,不回傳 Response。

## 紀律

1. **業務邏輯一律寫在 `src/server/` 的純函式。** route handler 只做三件事:解析請求、呼叫 `src/server/` 的函式、回傳 JSON。不要在 route handler 裡寫任何邏輯或直接碰資料庫。理由:之後這個 API 要搬到獨立伺服器常駐。
2. `data/` 必須在 `.gitignore` 裡。
3. 一次只做一個垂直切片,結束時必須是跑得起來、可以 commit 的狀態。
4. 改動超過一個檔案之前,先說明你要改哪些檔案、為什麼,等我確認。

## 語言

與我對話一律用**繁體中文**。程式碼、變數名、commit message 用英文。