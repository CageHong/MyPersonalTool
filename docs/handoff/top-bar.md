# 開發任務:工具切換頂列(top-bar)【先擬計畫】

## 0. 準備
`git switch -c gemini/top-bar main`(main 要包含 `88ee520`)。worktree 與假資料規則照 `AGENTS.md`。

## 目標
實作 `docs/platform/decisions.md` §7 的第一階段:每一頁最上方的全域頂列(九宮格按鈕 + 目前工具名稱 + 九宮格面板)、工具清單 `src/platform/tools.ts`、回到上次網址、序列快捷鍵。狀態列(頂列右邊)這張卡只留空位。

補充(§7 沒寫的實作細節):
- 高度暫用既有 token、接近 32px;不新增 token、不改 `globals.css`(高度是待決事項)。
- 快捷鍵:`g` 後 1 秒內按 `h` 首頁、`t` tasks、`f` finance;焦點在 input / textarea / select / contenteditable 時不作用。面板開著時 Esc 關閉、焦點回到九宮格按鈕。
- 首頁的工具入口改讀 `tools.ts`(現在是 `src/app/page.tsx` 裡的常數)。

## 背景
`CLAUDE.md`(平台規則、樣式規則)、`docs/platform/decisions.md` §4、§7。頂列屬於平台:不匯入 `src/modules/`。

## 可以改的檔案
- 新增:`src/platform/tools.ts`、`src/app/_shell/`(元件與 `.module.css`)
- `src/app/layout.tsx`、`src/app/page.tsx`、`src/app/page.module.css`
- `src/modules/finance/components/FinanceShell.tsx` 與 `.module.css`:只拿掉側欄最上方的 `finance` 標題,以及為了讓版面填滿頂列以下的高度而必要的改動
- tasks 最外層容器的高度規則(哪個檔寫進計畫)
- `docs/platform/backlog.md`(頂列那條標為第一階段完成)

## 不能改的檔案
`src/app/globals.css`、`src/app/api/`、tasks 與 finance 的其他元件與 server 程式、`AGENTS.md`、`CLAUDE.md`、`.claude/rules/`、`docs/platform/decisions.md`

## 完成條件
- `npx next typegen` 後,`npx tsc --noEmit`、`npm run lint`、`npm test` 全過。
- `npm run start` 手動確認:首頁、`/tasks`、`/finance/transactions` 都有頂列;三個工具可以互相切換;從 `/tasks?view=habits` 切到 finance 再切回來,回到 habits;快捷鍵可用且在輸入框裡不觸發;鍵盤可以操作面板;tasks 三欄與 finance 側欄沒有多出捲軸。
- commit 前綴 `platform:`。

## 實作計畫(先填這段,commit 後停下等確認)

### 1. 要新增／修改的檔案
- **新增 `src/platform/tools.ts`**：定義 `ToolId`、`ToolDefinition` 與 `TOOLS`（`tasks`、`/tasks`；`finance`、`/finance`），包含 `id`、`name`、`href`、`description`、`icon`（文字縮寫/emoji）、`shortcutKey`（`t` / `f`）與預留 `accent` 欄位；提供純函式 `findToolByPathname(pathname)` 與 last-url 的 key/驗證輔助函式（驗證儲存網址仍屬於該工具路徑）。另新增 `src/platform/tools.test.ts` 測試純函式。
- **新增 `src/app/_shell/AppShell.tsx`、`src/app/_shell/AppShell.module.css`、`src/app/_shell/TopBar.tsx`、`src/app/_shell/TopBar.module.css`**：
  - `AppShell`：Client component（或外層包 `TopBar` 與 `<div className={styles.content}>{children}</div>`），整體採 `height: 100dvh; display: flex; flex-direction: column; overflow: hidden;`，`.content` 採 `flex: 1; min-height: 0; display: flex; flex-direction: column; overflow-y: auto;`。
  - 網址記憶：拆出內部小元件 `LastUrlTracker`（呼叫 `usePathname()` 與 `useSearchParams()`），包在 `<Suspense fallback={null}>` 內以免影響 static generation；路由屬於某工具時將 `pathname + search` 寫入 `localStorage`（`try/catch` 保護）。
  - `TopBar`：高度用 `--space-5`（32px），全用 `globals.css` 語意層 token（底色 `--color-column-aside`、底線 `--color-divider`、文字 `--color-text`）。左側為九宮格按鈕（`aria-haspopup="menu"`、`aria-expanded`、`aria-label`）與目前工具名稱（首頁顯示 `personal-tools`，其餘顯示對應 `tool.name`）；右側為留空的狀態列容器。
  - 九宮格面板：列出「首頁（`/`）」與 `TOOLS` 各工具，目標網址優先讀取 `localStorage` 中該工具上次停留網址（無紀錄或無效則退回 `tool.href`），首頁固定回 `/`。支援點擊外部關閉、開啟時聚焦第一個項目、方向鍵（`ArrowUp` / `ArrowDown`）與 `Tab` 導覽、`Esc` 關閉並把焦點還給九宮格按鈕。
  - 序列快捷鍵：全域 `keydown` 監聽，忽略組合鍵（`meta`/`ctrl`/`alt`）與輸入元素（`INPUT`、`TEXTAREA`、`SELECT`、`contenteditable`）；按 `g` 後 1000ms 內按 `h`/`t`/`f` 導向首頁或對應工具（上次網址），逾時或按其他鍵清除等待狀態。
- **修改 `src/app/layout.tsx`**：在 `<body>` 內以 `<AppShell>{children}</AppShell>` 包住 `{children}`。
- **修改 `src/app/page.tsx`、`src/app/page.module.css`**：`page.tsx` 移除本地 `TOOLS` 常數，改從 `@/platform/tools` 匯入；`page.module.css` 的 `.page` 補上 `width: 100%;` 以確保在 flex column 容器內維持置中與寬度。
- **修改 `src/modules/finance/components/FinanceShell.tsx`、`src/modules/finance/components/FinanceShell.module.css`**：移除側欄頂部的 `<p className={styles.title}>finance</p>` 與對應 `.title` 樣式；`.layout` 的 `height: 100dvh;` 改為 `flex: 1; min-height: 0;`，讓版面填滿頂列以下區域且不出現外層捲軸。
- **修改 `src/modules/tasks/components/ThreeColumnLayout.module.css`**：`.layout` 的 `height: 100dvh;` 改為 `flex: 1; min-height: 0;`，讓三欄剛好填滿頂列以下區域且不出現外層捲軸。
- **修改 `docs/platform/backlog.md`**：將「工具切換頂列」項目更新為第一階段完成（狀態列等摘要 API）。

### 2. 實作與驗證步驟
1. 建立 `src/platform/tools.ts` 與 `src/platform/tools.test.ts`（純函式與工具清單），更新 `src/app/page.tsx` 與 `page.module.css`。
2. 建立 `src/app/_shell/` 下的 `TopBar` 與 `AppShell`，並接入 `src/app/layout.tsx`。
3. 調整 `FinanceShell.tsx` / `.module.css` 與 `ThreeColumnLayout.module.css` 的高度與標題。
4. 更新 `docs/platform/backlog.md`。
5. 執行 `npx next typegen`、`npx tsc --noEmit`、`npm run lint`、`npm test`，並以 `npm run start` 手動驗證完成條件。

## 回報(Gemini 填寫)
- 做了什麼(每個檔案一行):
- 沒做什麼、為什麼:
- 每個完成條件怎麼驗證的:
- 最可能出錯的地方:
- 疑問:
