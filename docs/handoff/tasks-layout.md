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
- 常數(像素,全案唯一來源):`MIN_LEFT_WIDTH = 180`、`MIN_MIDDLE_WIDTH = 360`、`MIN_RIGHT_WIDTH = 320`、`DEFAULT_LEFT_WIDTH = 240`、`DEFAULT_RIGHT_WIDTH = 320`。
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
  - 提供 `parseStoredLayout(raw: string | null): StoredLayout`(解析失敗時退回預設,寬度 clamp 至 `>= 對應最小值`)與 `clampDragWidth(...)`。
- **縮放與自動收合判斷**(`resolveLayout(input)`):
  - 輸入:`containerWidth: number | null`、`stored: StoredLayout`。
  - 若 `containerWidth === null || containerWidth <= 0`(尚未量到寬度):維持 `stored` 寬度與收合狀態,`autoLeftCollapsed = false`、`autoRightCollapsed = false`。
  - 縮放順序(§6k):
    1. **先縮中欄**至 `MIN_MIDDLE_WIDTH`(360)。
    2. **再縮左右欄**至各自最小寬度:計算保留中欄 360 後的可分配側欄寬度,將超支部分依目前左右兩欄各自超出最小寬度(`width - minWidth`)的比例縮減,兩欄都不低於各自最小值。
    3. **都到底才自動收合**:若 `containerWidth < (leftCollapsed ? 0 : MIN_LEFT_WIDTH) + MIN_MIDDLE_WIDTH + (rightCollapsed ? 0 : MIN_RIGHT_WIDTH)`,優先將右欄自動收合(`rightCollapsed = true`、`autoRightCollapsed = true`),並重新以剩餘左側欄計算縮放;若仍 `< MIN_LEFT_WIDTH + MIN_MIDDLE_WIDTH`,再將左欄自動收合(`leftCollapsed = true`、`autoLeftCollapsed = true`)。
  - 回傳 `{ leftWidth, rightWidth, leftCollapsed, rightCollapsed, autoLeftCollapsed, autoRightCollapsed }`。`auto*` 旗標絕不寫回 `localStorage`,視窗放寬後自動回到使用者設定。
  - `layout.test.ts` 涵蓋:寬度足夠、縮放順序(中欄先縮、兩側依超出比例後縮)、右欄改抽屜、左欄也收、自動收合旗標、使用者手動收合不受影響、視窗變寬回到使用者設定、非法 JSON 讀取。

### 2. 元件拆分(`src/modules/tasks/components/`)
- **`ResizeHandle.tsx` + `ResizeHandle.module.css`**:
  - 不佔版面寬度(絕對定位於分隔線上,寬度 0 佔位 / 可點熱區 6px 置中覆蓋),不進 Tab 順序,不設 `aria-valuenow`。
  - 使用 Pointer Events + `setPointerCapture`,`pointerType !== 'mouse'` 一律忽略。
  - 拖拉中不 `setState`:透過 ref 直接更新 `.layout` 的 `--left-width` / `--right-width` CSS 變數並設 `data-resizing="true"` 鎖住 `cursor` 與 `user-select`;放開(`pointerup` / `pointercancel`)時才寫回 state 與 `localStorage`。
- **`ThreeColumnLayout.tsx` + `ThreeColumnLayout.module.css`**:
  - `.layout` 設 `position: relative`,並將 `MIN_MIDDLE_WIDTH`、`effective.leftWidth`、`effective.rightWidth` 透過 CSS 自訂屬性(`--middle-min-width`、`--left-width`、`--right-width`)傳入,CSS 不重複寫死欄寬數值。
  - 首次 render 用預設展開狀態;掛載後於 `useEffect` 照 `HabitBlock.tsx` 寫法(`try/catch` + `// eslint-disable-next-line react-hooks/set-state-in-effect`)讀取 `localStorage`,並以 `ResizeObserver` 監聽 `.layout` 寬度。
  - **右欄 `<section>` 只畫一份**:不放進中欄 `<section>` 內(避免中欄捲動與 `captureFocus` 誤判)。當 `effective.rightCollapsed && hasSelection` 時改套抽屜 class(絕對定位蓋在 `.layout` 右側,寬度 `--right-width`,中欄不變暗、點中欄不關),頂端顯示關閉鈕;按右欄展開鈕時直接切回一般欄 class,`TaskDetail` / `HabitDetail` 不重新掛載、草稿保留。關閉抽屜時從網址移除 `task` / `habit`,並將焦點移回中欄對應列(`[data-task-control="row"]` / `[data-habit-control="row"]`)。
- **`TaskList.tsx` / `TaskList.module.css` 與 `HabitList.tsx` / `HabitList.module.css`**:
  - 中欄標題列最左與最右放入 `leftToggle`、`rightToggle` 切換鈕。兩顆鈕依實際畫面狀態顯示 `aria-expanded` 與 `aria-label`(收合左欄 / 展開左欄 / 收合右欄 / 展開右欄),因視窗太窄而自動收合期間設 `aria-disabled="true"` 與 `title="視窗太窄"`,放寬後恢復。

### 3. 文件更新(`docs/tasks/ui/layout.md`、`docs/tasks/backlog.md`)
- `docs/tasks/ui/layout.md`:補上「欄寬、收合與抽屜」一節。
- `docs/tasks/backlog.md`:將「版面 session」標明已完成。

### 4. 驗證步驟
- `npx next typegen`、`npx tsc --noEmit`、`npm run lint`、`npm test`。
- 於 `npm run dev` 用假資料逐項手動驗證完成條件(含清單捲動時抽屜固定不動、視窗 < 860px 時按鈕停用狀態、從抽屜按展開後標題草稿保留)並記錄於回報。

## 主線審查(2026-11-22)

方向對,以下 7 點改進計畫後直接實作,不用再等確認。主線已把 main 併進本分支:§6k 新增了三列(縮放順序、自動收合時按鈕停用、待決兩項定案)。

1. **抽屜不放在中欄 `<section>` 裡。** 中欄是 `overflow-y: auto` 的捲動容器,絕對定位的子元素會跟清單一起捲走;`captureFocus` 用 `column.contains(active)` 判斷焦點在中欄,抽屜放進去會把右欄的焦點誤判成中欄。改成右欄 `<section>` 只畫一份,收合且有選取時改套抽屜的 class(絕對定位蓋在中欄右側,`.layout` 設 `position: relative`)。從抽屜按展開時 `TaskDetail` / `HabitDetail` 不重新掛載、草稿保留,`key` 規則不動;`DetailDrawer` 不另外包右欄內容,只需要關閉鈕。
2. **縮放順序寫進 `resolveLayout`**(§6k):先縮中欄到 360,再把左右欄縮到最小寬度(依各自超出最小值的部分等比例縮),都到底才自動收右欄、再收左欄。回傳實際畫出的 `leftWidth`、`rightWidth`,加上 `autoLeftCollapsed`、`autoRightCollapsed`。測試加:縮放順序(中欄先、兩側後)、自動收合旗標。
3. **自動收合期間切換鈕停用**(§6k):`aria-disabled` + `title="視窗太窄"`,放寬後恢復。兩顆鈕都有 `aria-expanded`、`aria-label`(收合左欄 / 展開左欄 / 收合右欄 / 展開右欄),依實際畫面狀態顯示。
4. **拖拉中不在每次 move 都 setState**(`ThreeColumnLayout` 一 setState 就重畫整份清單)。拖拉中用 ref 改 `.layout` 上的 CSS 自訂屬性,放開時才寫回 state 與 localStorage。用 Pointer Events + `setPointerCapture`,`pointerType !== 'mouse'` 就忽略。拖拉中鎖住 `cursor` 與 `user-select`。
5. **把手不佔版面寬度**:絕對定位在分隔線上,最小寬度加總才會剛好等於門檻。不進 Tab 順序,不需要 `aria-valuenow`。
6. **寬度只在 `lib/layout.ts` 的常數出現一次**:CSS 不寫 `min-width: 360px`,既有的 `flex: 0 0 15rem`、`20rem` 也改由常數經 inline style / CSS 自訂屬性帶入。
7. **讀 localStorage 照 `HabitBlock.tsx` 的寫法**(try/catch + 同一條 eslint-disable 註解)。抽屜關閉後焦點移到該任務(或習慣)在中欄的列(`data-task-control="row"` / `data-habit-control="row"`)。

其餘照你的計畫。完成條件另加三項手動檢查:清單捲動時抽屜固定不動;視窗小於 860px 時兩顆鈕的停用狀態;從抽屜按展開後,正在打的標題草稿還在。

## 回報(Gemini 填寫)
- 做了什麼(每個檔案一行):
  - `src/modules/tasks/lib/layout.ts`:集中定義欄寬常數(`MIN_LEFT_WIDTH=180`、`MIN_MIDDLE_WIDTH=360`、`MIN_RIGHT_WIDTH=320`、預設 240/320)、`localStorage` key `'tasks:layout'` 與解析/clamp 函式,以及依 §6k 縮放順序(先縮中欄、再依超出比例縮兩側、最後右欄優先改抽屜/再左欄收起)計算的純函式 `resolveLayout`。
  - `src/modules/tasks/lib/layout.test.ts`:撰寫 11 個單元測試涵蓋 `parseStoredLayout`、`resolveLayout`(寬度足夠、中欄先縮、兩側依比例後縮、右欄改抽屜、左欄也收、自動收合旗標、手動收合不受影響、視窗放寬回到使用者設定)與 `clampDragWidth`。
  - `src/modules/tasks/components/ResizeHandle.tsx` 與 `ResizeHandle.module.css`:建立零佔位垂直拖拉把手,僅處理滑鼠 Pointer Events + `setPointerCapture`,不進 Tab 順序。
  - `src/modules/tasks/components/TaskList.tsx`、`TaskList.module.css`、`HabitList.tsx`、`HabitList.module.css`:於中欄標題列最左與最右加入 `leftToggle` / `rightToggle` 插槽,使切換鈕在所有檢視下位置固定。
  - `src/modules/tasks/components/ThreeColumnLayout.tsx` 與 `ThreeColumnLayout.module.css`:以 CSS 自訂屬性帶入欄寬與最小寬度,拖拉中僅改 DOM style 不觸發 `setState`,放開時寫入 state 與 `localStorage`;掛載後於 `useEffect` 讀 `localStorage` 與監聽 `ResizeObserver`;右欄 `<section>` 只畫一份並於收合且有選取時切換為抽屜樣式(固定於 `.layout` 不隨中欄捲動、中欄不變暗、點中欄不關、抽屜標題列放「關閉」與 `rightToggle` 以免被遮擋、關閉時焦點回中欄對應列)。
  - `docs/tasks/ui/layout.md`:補上「欄寬、收合與抽屜」一節。
  - `docs/tasks/backlog.md`:將「版面 session」標明已完成。
- 沒做什麼、為什麼:
  - 拖拉把手未支援觸控、抽屜開著時中欄未變暗且點中欄不關(依任務卡與 §6k 決策)。
- 每個完成條件怎麼驗證的:
  - **`npx next typegen`、`npx tsc --noEmit`、`npm run lint`、`npm test`**:於最終修改後執行全過(`npm test` 68 suites / 538 tests 全過,含 `layout.test.ts` 11 tests)。
  - **手動驗證(`npm run dev` + 暫存假資料 `/tmp/pt-tasks-layout-test`,透過無頭瀏覽器於 `http://localhost:3000/tasks` 實測)**:
    1. **Hydration 檢查**:`1280x800` 開啟與重新整理皆無 hydration 警告或 console 錯誤。
    2. **拖拉欄寬與持久化**:建立 22 筆假任務後,初始寬度 `240 / 720 / 320`px;左把手右拖 +60px、右把手左拖 -60px 變為 `300 / 600 / 380`px,重整後仍為 `300 / 600 / 380`px。
    3. **兩顆切換鈕收合/展開與持久化**:點收合左欄、收合右欄後中欄擴為 `1280px`,重整後維持收合。
    4. **抽屜行為與網址 `task`**:右欄收合時點任務開啟抽屜(`?task=1`),中欄不變暗、點中欄空白處不關抽屜、點另一任務切換至 `?task=2`;點抽屜「關閉」後移除網址 `task` 並將焦點移回中欄對應任務列按鈕。
    5. **清單捲動時抽屜固定不動**:捲動中欄清單(`Test Task 1` 由 `y: 176.5` 捲至 `y: 1`),抽屜 `boundingBox` 固定在 `top=32` 不動。
    6. **抽屜開著時按右欄展開鈕保留草稿**:於抽屜標題欄聚焦輸入 `" DRAFT2"`(不失焦),點「展開右欄」後抽屜消失、同任務於一般右欄顯示,且標題輸入框仍保有 `" DRAFT2"` 草稿。
    7. **窄視窗自動收合與停用狀態、放寬復原**:恢復展開(`300 / 600 / 380`)後,縮至 `800x700`(< 860px)右欄自動收合、右鈕顯示 `aria-disabled="true"` 與 `title="視窗太窄"`;縮至 `480x700`(< 540px)左欄也自動收合、左鈕顯示 `aria-disabled="true"` 與 `title="視窗太窄"`;放回 `1280x800` 後兩鈕解除停用並恢復使用者原本的 `300 / 600 / 380`px 展開狀態。
- 最可能出錯的地方:
  - 抽屜開啟時覆蓋在 `.layout` 右上角,若 `rightToggle` 留在中欄標題列會被抽屜(及「關閉」鈕)遮住無法點擊,因此抽屜開啟時改將 `rightToggle` 放在 `.drawerHeader` 右端同一位置(同時中欄不重複畫第二顆)。
  - 自動收合時兩顆切換鈕使用 `aria-disabled="true"` 而非原生 `disabled`,讓 `title="視窗太窄"` 提示仍可觸發且不掉焦點。
- 疑問:
  - 無。
