# 開發任務:Tasks 版面——欄寬拖拉、左右欄收合、抽屜(tasks-layout)

**先擬計畫**:讀完程式碼後在「實作計畫」寫出要改的檔案與步驟(含元件拆法、localStorage 的 key 與形狀、自動收合的判斷方式),commit 後停下,等主線確認才實作。

## 0. 準備
`git switch -c gemini/tasks-layout main`(main 要包含這張卡的 commit)。worktree 與假資料規則照 `AGENTS.md`。

## 目標
實作 `docs/tasks/decisions.md` §6k 全部條目。§6k 的「待決」兩項:拖拉把手不做觸控;抽屜開著時中欄**不變暗、點中欄不關抽屜**(先求最簡單,用了再說)。

## 背景
`CLAUDE.md`、`.claude/rules/` 裡跟 tasks 有關的檔、`docs/tasks/ui/layout.md`(三欄、網址狀態、焦點——動 state 與 effect 前必讀)、`docs/tasks/decisions.md` §4、§5、§6k、§H2(localStorage 在 effect 裡讀的先例)、`docs/platform/decisions.md` §7(全域頂列在三欄上方)。

## 可以改的檔案
- `src/modules/tasks/components/` 底下的版面相關元件(`ThreeColumnLayout.tsx` 與它的 CSS Module;需要時新增元件,例如拖拉把手、抽屜)
- `src/modules/tasks/lib/` 新增純函式(例如「依視窗寬度與最小寬度決定哪欄自動收合」),附測試
- `docs/tasks/ui/layout.md`(補上欄寬、收合、抽屜的行為說明)
- `docs/tasks/backlog.md`(版面 session 那條標明完成)

## 不能改的檔案
`src/modules/tasks/server/`、`src/modules/tasks/db/`、`src/app/api/`、`src/platform/`、`src/app/globals.css`、`docs/tasks/decisions.md`、`AGENTS.md`、`CLAUDE.md`。不改既有的資料流規則(畫面更新一律重抓、網址是選取狀態的來源)。

## 完成條件
- `npx next typegen` 後,`npx tsc --noEmit`、`npm run lint`、`npm test` 全過;自動收合的判斷是純函式,測試涵蓋:寬度足夠、右欄改抽屜、左欄也收、使用者手動收合時不受影響、視窗變寬後回到使用者的設定。
- 在 `npm run dev` 用假資料手動驗證,每一項寫進回報:拖拉三欄寬度並重新整理後保持;兩顆切換鈕收合 / 展開並重新整理後保持;右欄收合時點任務出現抽屜、網址有 `task`;抽屜開著時按右欄展開鈕,抽屜消失、同一個任務在右欄;縮窄視窗依序出現抽屜、左欄收起,再放寬回到原本的設定;重新整理時沒有 hydration 警告(看瀏覽器 console)。
- commit 前綴 `tasks:`。

## 實作計畫(Gemini 先填,等主線確認)

### 1. 純函式與測試(`src/modules/tasks/lib/layout.ts`、`src/modules/tasks/lib/layout.test.ts`)
- 常數(像素):`MIN_LEFT_WIDTH = 180`、`MIN_MIDDLE_WIDTH = 360`、`MIN_RIGHT_WIDTH = 320`、`DEFAULT_LEFT_WIDTH = 240`、`DEFAULT_RIGHT_WIDTH = 320`。
- `localStorage` 設定:
  - Key:`'tasks:layout'`
  - 資料形狀(`StoredLayout`):
    ```ts
    export type StoredLayout = {
      leftWidth: number
      rightWidth: number
      leftCollapsed: boolean
      rightCollapsed: boolean
    }
    ```
  - 提供純函式 `parseStoredLayout(raw: string | null): StoredLayout`(解析失敗或欄位型別不符時回傳預設值,寬度 clamp 至 `>= 對應最小值`)與 `clampColumnWidths(...)`。
- **自動收合判斷**(`resolveLayout(input)`):
  - 輸入:`containerWidth: number | null`、`stored: StoredLayout`。
  - 若 `containerWidth === null || containerWidth <= 0`(首次掛載 `ResizeObserver` 尚未量到寬度):直接回傳 `stored` 的 `leftCollapsed` / `rightCollapsed`,不自動收合。
  - 否則從使用者的 `leftCollapsed = stored.leftCollapsed`、`rightCollapsed = stored.rightCollapsed` 出發:
    1. **右欄優先改抽屜**:若 `!rightCollapsed`,計算目前需要的最小總寬度 `required = (leftCollapsed ? 0 : MIN_LEFT_WIDTH) + MIN_MIDDLE_WIDTH + MIN_RIGHT_WIDTH`。若 `containerWidth < required`,則 `rightCollapsed = true`(標記 `autoRightCollapsed = true`)。
    2. **左欄再收起**:若 `!leftCollapsed`,計算 `required = MIN_LEFT_WIDTH + MIN_MIDDLE_WIDTH`。若 `containerWidth < required`,則 `leftCollapsed = true`(標記 `autoLeftCollapsed = true`)。
    3. 依最終展開狀態計算可視欄位的安全渲染寬度(確保不把中欄擠到 `MIN_MIDDLE_WIDTH` 以下)。
  - **不覆寫儲存狀態**:`autoLeftCollapsed` / `autoRightCollapsed` 只存在衍生計算結果,絕不寫回 `localStorage`;視窗變寬時自動回到使用者的 `stored` 設定。
  - `layout.test.ts` 涵蓋:寬度足夠、右欄改抽屜、左欄也收、使用者手動收合時不受影響(例:左欄已手動收合時窄到 680 以下才收右欄)、視窗變寬後回到使用者設定、非法 JSON 讀取與寬度下限 clamp。

### 2. 元件拆分(`src/modules/tasks/components/`)
- **`ResizeHandle.tsx` + `ResizeHandle.module.css`**:
  - 垂直拖拉把手(`role="separator"`、`aria-orientation="vertical"`、`aria-label`),只支援滑鼠 `onMouseDown` + `window` `mousemove` / `mouseup`(不做觸控)。
  - 拖拉結束(`mouseup`)與拖拉過程中即時更新對應欄寬,並於 `mouseup` 時寫入 `localStorage`。
- **`DetailDrawer.tsx` + `DetailDrawer.module.css`**:
  - 覆蓋在中欄上方(中欄外層設 `position: relative`,抽屜採 `position: absolute; top: 0; right: 0; bottom: 0;`,寬度沿用 `rightWidth`,若中欄更窄則 `max-width: 100%`)。
  - 頂端附「關閉」按鈕,點擊時從網址移除 `task`(或 `view=habits` 時移除 `habit`)。
  - 抽屜開著時中欄**不變暗**、點中欄**不關抽屜**。
- **`TaskList.tsx` / `TaskList.module.css` 與 `HabitList.tsx` / `HabitList.module.css`**:
  - 接受 `leftToggle?: ReactNode` 與 `rightToggle?: ReactNode` props。
  - `TaskList` 的 `<header className={styles.toolbar}>` 最左邊放 `leftToggle`、標題旁保留 `ViewSettingsMenu`、最右邊放 `rightToggle`。
  - `HabitList` 補上對齊的 `<header className={styles.toolbar}>`(最左 `leftToggle`、標題「習慣」、最右 `rightToggle`),使兩顆切換鈕在所有檢視下位置固定不變。
- **`ThreeColumnLayout.tsx` + `ThreeColumnLayout.module.css`**:
  - 首次 render 一律使用預設展開狀態(`DEFAULT_LEFT_WIDTH`、`DEFAULT_RIGHT_WIDTH`、`leftCollapsed: false`、`rightCollapsed: false`),避免 SSR hydration 不一致。
  - 掛載後於 `useEffect` 讀取 `localStorage` 並以 `ResizeObserver` 監聽 `.layout` 容器寬度。
  - 左欄(`!effective.leftCollapsed`)與左拖拉把手、中欄(`flex: 1; min-width: 360px` + `position: relative` 容納 `DetailDrawer`)、右拖拉把手與右欄(`!effective.rightCollapsed`)。
  - 抽屜顯示條件:`effective.rightCollapsed && (view === 'habits' ? selectedHabit !== null : selectedTask !== null)`。按右欄展開鈕時設 `rightCollapsed: false` 並寫入 `localStorage`,抽屜隨即消失、同一個任務(或習慣)改在右欄顯示(`key` 相同或重新掛載於右欄)。
  - 所有樣式只引用 `src/app/globals.css` 既有的語意變數(`--color-column-aside`、`--color-column-main`、`--color-divider`、`--space-*`、`--radius` 等),不改 `globals.css`。

### 3. 文件更新(`docs/tasks/ui/layout.md`、`docs/tasks/backlog.md`)
- `docs/tasks/ui/layout.md`:補上「欄寬、收合與抽屜」一節,記錄最小寬度、切換鈕位置、抽屜觸發與關閉條件、`localStorage` 持久化與自動收合不覆寫使用者設定的規則。
- `docs/tasks/backlog.md`:將「版面 session」標明已完成。

### 4. 驗證步驟
- `npx next typegen`、`npx tsc --noEmit`、`npm run lint`、`npm test`。
- 於 `npm run dev` 用假資料逐項手動驗證完成條件並記錄於回報。

## 回報(Gemini 填寫)
- 做了什麼(每個檔案一行):
- 沒做什麼、為什麼:
- 每個完成條件怎麼驗證的:
- 最可能出錯的地方:
- 疑問:
