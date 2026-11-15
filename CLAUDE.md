@AGENTS.md

# personal-tools

個人工具平台:單一 Next.js app,每個工具一個模組。目前有 tasks(任務管理)與 finance(複式簿記記帳,原本的 PACR),之後會有 media tracker、Fog of World 整合。

## 規則分層

規則分三層,動手之前先讀到對應的那一層(決策見 `docs/platform/decisions.md` §5):

- **平台**:本檔。所有工具都適用。
- **工具**:`.claude/rules/<工具>.md`。Claude Code 讀到下表的路徑時會自動載入;其他環境照下表自己讀。
- **套件**:`packages/<套件>/CLAUDE.md`。

| 要動的路徑 | 屬於 | 先讀 |
|---|---|---|
| `src/modules/tasks/`、`src/app/tasks/`、`src/app/api/tasks/` | tasks | `.claude/rules/tasks.md` |
| `src/modules/finance/`、`src/app/finance/`、`src/app/api/finance/`、`packages/statement-parsers/` | finance | `.claude/rules/finance.md` |
| `src/platform/`、`src/app/api/_lib/`、`src/app/globals.css`、`src/app/layout.tsx`、`src/app/page.tsx`、根目錄的設定檔 | 平台 | 本檔、`docs/platform/` |

工具規則可以比本檔嚴,不能放寬;看起來衝突時先停下來問。新增工具時:加一個 `.claude/rules/<工具>.md`(`paths` 涵蓋上表那幾類位置),並在上表加一列。

## 文件分工

規則檔只放**動手之前必須先知道、否則會做錯的規則與契約**。會隨程式碼變動的描述(欄位表、端點表、各功能的互動細節)放在 `docs/<層>/`,動到對應區域時才讀:`docs/platform/` 是平台,`docs/<工具>/` 是各工具。

已定案的決策與理由記在各層的 `decisions.md`。規則衝突時以該層 `decisions.md` 較新的條目為準;需要推翻其中任何一條時,先停下來問,不要自行改。

`docs/` 底下的描述性內容與程式碼不一致時以程式碼為準,並在同一次修改裡更新文件。

有些工具的進度與決策紀錄含個人資料,放在 repo 外(目前是 finance)。repo 內的規則與文件不引用 repo 外的決策編號,每條規則本身要寫完整。

## 範圍

平台層級明確**不做**(提出前先問我):首頁 shell、使用者帳號、部署設定、共用設計系統、深色模式。各工具自己的範圍寫在工具規則檔。

## 技術棧

- Next.js App Router + TypeScript
- Drizzle ORM + Drizzle Kit + better-sqlite3
- CSS Modules + CSS 變數(**不用 Tailwind**)
- 測試:`node --import tsx --test`(`npm test`,範圍是 `src/` 與 `packages/*/src/`),檔名 `*.test.ts`,放在被測的檔案旁邊

Next.js 的正確寫法一律查 `node_modules/next/dist/docs/01-app/`。
`02-pages/` 是舊的 Pages Router,本專案不使用,不要參考。

## 目錄結構

- `src/app/<工具>/` — 頁面(網址 `/<工具>`);`src/app/page.tsx` 只把 `/` 轉址到 `/tasks`
- `src/app/api/<工具>/` — route handler(網址一律以 `/api/<工具>/` 開頭,沒有例外)
- `src/app/api/_lib/` — route handler 共用的 HTTP 輔助函式
- `src/app/globals.css` — 全站共用的 CSS 變數(`:root`)
- `src/modules/<工具>/` — 一個工具的全部程式:
  - `server/` — 業務邏輯(純函式)
  - `db/` — Drizzle schema 與連線
  - `components/` — UI 元件
  - `lib/` — 前後端共用的純函式與型別(不碰資料庫與檔案系統)
  - `drizzle/` — migration 檔(進版控);設定在 `drizzle.config.ts`,用 `npm run <工具>:db:generate` 產生。套用一律經過 `src/platform/migrations.ts` 的 `runMigrations`(`npm run <工具>:db:migrate` 是工具自己的 `tools/migrate.ts`),不直接用 `drizzle-kit migrate` 或 Drizzle 的 `migrate`。每個工具有一支測試(`db/migrations.test.ts`)檢查最新的 migration 不會弄丟資料;它的種子照倒數第二版的 schema 寫,migration 改到種子用到的欄位時跟著更新。已經套用過的 migration 不改 `meta/_journal.json` 的 `when`(Drizzle 用它判斷哪些還沒套用)
  - 工具額外的資料夾寫在工具規則檔
- `src/platform/` — 各工具共用、不屬於任何一個工具的程式:資料夾位置 `dataDir.ts`、套用 migration 的 `migrations.ts`、業務錯誤的基底 `errors.ts`;測試輔助在 `testing/`
- `packages/<套件>/` — npm workspaces 的套件(目前有 `statement-parsers`):不匯入 `src/` 的任何東西;`src/` 的程式從套件名稱 `@personal-tools/<套件>` 匯入
- 資料庫不在 repo 裡:`<資料夾>/<工具>/`,資料夾由 `PERSONAL_TOOLS_DATA_DIR` 指定,預設是 repo 旁邊的 `personal-tools-data/`

**依賴方向**:模組可以匯入 `src/platform/`,`src/platform/` 不匯入模組。模組之間不互相匯入(schema、server 函式、型別都不行);共用的東西放 `src/platform/`。每個工具自己一個 SQLite 檔,表名加工具前綴。

## 錯誤與驗證契約

錯誤回應一律用 HTTP 狀態碼 + 結構化 JSON:

```json
{ "error": { "code": "VALIDATION_FAILED", "message": "...", "fields": { "title": "required" } } }
```

所有工具共用三種錯誤碼,不要自行增加:

| 狀態碼 | code | 用在 |
|---|---|---|
| 400 | `VALIDATION_FAILED` | 輸入不合法,附 `fields` |
| 404 | `NOT_FOUND` | 指定 id 不存在 |
| 500 | `INTERNAL_ERROR` | 其他所有情況 |

**不要**用「一律回 200,錯誤放 body」的做法。

驗證的位置(理由見 `docs/platform/decisions.md` §1):

- 驗證邏輯寫在 `src/modules/<工具>/server/` 的函式裡,不寫在 route handler。
- 驗證失敗時 throw 自訂錯誤類別(帶 `fields` 資訊),定義在 `src/modules/<工具>/server/`,繼承 `src/platform/errors.ts` 的 `ValidationErrorBase`(找不到是 `NotFoundErrorBase`)。`src/app/api/_lib/http.ts` 只認基底,不匯入任何工具。
- route handler 用 `instanceof` 判斷錯誤類別,對映到狀態碼。`server/` 不可以知道 HTTP 的存在——不 import Next.js 的任何東西,不回傳 Response。

驗證 vs 解析的判準:這條規則在**非 HTTP 的呼叫路徑**上還成立嗎?

- 成立(例:title 不能為空)→ 業務驗證,寫在 `server/`
- 不成立(例:網址上的 id 是 "abc"、body 不是合法 JSON)→ 協定層解析,寫在 route handler,同樣回 `VALIDATION_FAILED`

前端不從 `src/modules/<工具>/server/` import 任何東西(型別也不行)。

## 樣式

理由見 `docs/platform/decisions.md` §3。

**樣式一律 CSS Modules。** 元件的 `.module.css` 不可以寫死顏色、間距、圓角、字級、字重、字型,一律引用 `src/app/globals.css` `:root` 的變數。需要新的值先加進 `:root`,不要在元件裡寫數值。

**CSS 變數分兩層**:

- 色票層 `--palette-*`:名字只描述顏色本身,不帶用途。
- 語意層 `--color-*`:名字描述用途,值一律指向色票層。

**元件只能引用語意層**,不得引用 `--palette-*`。需要新顏色時先看語意層有沒有合適的名字;沒有就新增語意變數指向既有色票,新增色票要先問。間距只能用 `--space-1` 到 `--space-5`,字級只能用 `--text-xs` 到 `--text-lg`。過場的時長與曲線只能用 `--motion-duration`、`--motion-easing`。

finance 的畫面直接用同一套色票與語意層,不另設主題色、不覆寫語意層(`docs/platform/decisions.md` §3)。

## 工作流程:依風險分級

指令會標明是哪一級。**沒標明時視為高風險。**

**低風險步驟**:只改 CSS 值或變數名稱、刪除沒有引用的程式碼、不改變任何行為。

- 可以直接實作,不必先交計畫。
- 完成後回報:改了哪些檔案、每個檔案改了什麼(一行)、`tsc` 與 `lint` 結果。
- 過程中發現需要改變行為,或範圍超出指令,停下來回報,不要自行擴大。

**高風險步驟**:涉及 state、effect、焦點管理、資料流、API、schema。

- 先列出要改的檔案與做法,等確認再寫。

## 紀律

1. **業務邏輯一律寫在 `src/modules/<工具>/server/` 的純函式。** route handler 只做三件事:解析請求、呼叫 `server/` 的函式、回傳 JSON。不要在 route handler 裡寫任何邏輯或直接碰資料庫。理由見 `docs/platform/decisions.md` §1。
2. repo 裡不放任何資料:每個工具的資料庫位置只在該工具的一個檔案定義(由 `src/platform/dataDir.ts` 推算,檔名寫在工具規則檔)。程式碼、註解、測試、範例設定裡的名稱與數字一律虛構。
3. 一次只做一個垂直切片,結束時必須是跑得起來、可以 commit 的狀態。
4. 改了行為就在同一次修改裡更新對應的 `docs/<層>/` 檔;新定案的決策追加到該層的 `decisions.md`(決策紀錄在 repo 外的工具,寫到它在 repo 外的紀錄)。
5. commit 訊息加前綴:`tasks:`、`finance:`,平台層級或跨工具的用 `platform:`。

## 語言

與我對話一律用**繁體中文**。程式碼、變數名、commit message 用英文。
