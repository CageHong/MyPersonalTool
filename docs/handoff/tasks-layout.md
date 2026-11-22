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

## 回報(Gemini 填寫)
- 做了什麼(每個檔案一行):
- 沒做什麼、為什麼:
- 每個完成條件怎麼驗證的:
- 最可能出錯的地方:
- 疑問:
