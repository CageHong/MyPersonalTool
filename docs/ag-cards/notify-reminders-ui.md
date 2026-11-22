# notify-reminders-ui:提醒視圖、右欄提醒編輯器、接下來的提醒 API、改規則就地更新

> 先擬計畫:讀完程式碼後在「實作計畫」寫出要改的檔案與步驟,commit 後停下,等主線確認才實作。

## 0. 準備
分支 `gemini/notify-reminders-ui` 由主線從 main 建好,上面有主線寫的測試與這張卡。直接在這個分支上工作。worktree 與假資料規則照 `AGENTS.md`。

## 目標
1. 前端:`docs/tasks/decisions.md` §6j「提醒」表末的兩條前端條目(`view=reminders` 視圖、摘要設定的存法),以及各項目右欄的提醒編輯器
2. 後端:「接下來會送的提醒」(§6j 表末「(2026-11-22 補)」那條)與它的 API
3. 後端:改重複規則時,只有排程欄位改變才重建實例(§6a「(2026-11-22 補)」那條)

卡 3(`done/notify-reminders.md`)做了提醒的表與 CRUD API;這張接在它上面。

## 背景
`docs/tasks/decisions.md` §6j「提醒」、§6a(實例與水位線)、`docs/tasks/api.md`(提醒、摘要設定、新的 `upcoming-notifications`)、`docs/tasks/ui/layout.md`(三欄、網址狀態、寫入佇列)、`docs/tasks/ui/habits.md`(習慣視圖怎麼整組換掉中欄與右欄)、`.claude/rules/tasks.md` 的「前端」段。

要點(規則以 decisions 為準,後端介面以測試為準):
- **後端 2**:`notifications.ts` 新增 `upcomingTaskNotifications(now: Date)` 與型別 `UpcomingNotification`(三種 `kind`,欄位見測試與 `api.md`)。只讀,不呼叫 `markTaskNotificationsSent`。重複規則的實例超過補齊終點時,用 `lib/recurrence.ts` 的 `expandRule` 判斷那天有沒有一次。route:`GET /api/tasks/upcoming-notifications`,`now` 用 `new Date()`。
- **後端 3**:`recurrence.ts` 的 `updateRule`。排程欄位是 `freq`、`interval`、`weekdays`、`startDate`、`until`;沒變時不呼叫 `deleteFutureIncomplete`、不重設水位線,改成更新同一批實例(今天之後、未完成)的 `title`、`notes`、`priority`、`excludeFromSummary`,範本改了就把它們的 checklist 整份換掉。`editedAt` 不動(規則變更不算使用者編輯實例)。
- **視圖 `view=reminders`**:同 `view=habits`,中欄與右欄整組換掉。左欄底部放入口。三區:
  - 三則摘要設定:時刻＋開關。改了就存;不合「早 < 下午 < 晚」時顯示「順序不對,還沒儲存」、不送,改對了自動整份 `PUT /api/tasks/notification-settings`
  - 接下來會送的提醒:`GET /api/tasks/upcoming-notifications`,顯示時刻(今天／明天)與標題;點任務或習慣跳到它的編輯欄(網址狀態照 `layout.md`)。`taskId` 是 null 的(實例還沒產生)點了不跳,或跳到同規則最早的未完成實例,計畫裡選一個並說明
  - 不進摘要的項目:`excludeFromSummary` 為 true 的任務、重複規則、習慣;點了跳到它的編輯欄。重複規則的資料從哪裡來(現有 API 夠不夠)請在計畫裡寫
- **右欄提醒編輯器**(任務、習慣的編輯欄;重複任務的實例編輯的是規則的提醒):
  - 任務:相對「當天／提前 N 天 HH:MM」、絕對「某天 HH:MM」;重複規則:只有相對,N ≤ 6;習慣:每天 HH:MM。每個項目上限 5 則,滿了就不給新增
  - 「不進摘要」開關(任務、規則、習慣既有的 PATCH 都收 `excludeFromSummary`)
  - 寫入照 `.claude/rules/tasks.md`:經過佇列、成功後重抓、不停用控制項、不做樂觀更新
- **錯誤代碼的中文**:加進 `src/modules/tasks/lib/errors.ts`:`times: out_of_order`、`date: in_past`、`reminders: too_many`,以及 `daysBefore` / `kind` / `time` 的 `invalid_value`
- 樣式照根目錄 `CLAUDE.md`「樣式」(只用語意層變數)。不加鍵盤快捷鍵

## 可以改的檔案
- 新增 `src/app/api/tasks/upcoming-notifications/route.ts`
- `src/modules/tasks/server/notifications.ts`、`src/modules/tasks/server/recurrence.ts`
- `src/modules/tasks/components/` 底下:新增提醒視圖與提醒編輯器的元件,改 `CategoryColumn`、任務與習慣的編輯欄、頁面切換視圖的地方
- `src/modules/tasks/lib/`(`views.ts` 加 `reminders` 視圖、`errors.ts`、新的前端型別)
- `src/app/tasks/`(只在視圖切換需要時)
- `src/app/globals.css`(只加語意層變數,指向既有色票)
- `docs/tasks/api.md`(拿掉「尚未實作」)、`docs/tasks/ui/` 新增 `reminders.md`、`docs/tasks/ui/layout.md`(視圖清單)、`docs/tasks/backlog.md`
- 要的話可以加自己的測試檔

## 不能改的檔案
`src/platform/`、`src/jobs/`、`src/modules/tasks/db/`(schema 不動)、`AGENTS.md`、`CLAUDE.md`、`docs/*/decisions.md`。主線的測試不能改。

## 測試(主線提供)
- `src/modules/tasks/server/notifications.test.ts` 的 `describe('upcomingTaskNotifications')`
- `src/modules/tasks/server/recurrence.test.ts` 的 `describe('updateRule: non-schedule changes update instances in place')`

## 完成條件
- `npx next typegen` 後 `npx tsc --noEmit`、`npm run lint`、`npm test` 全過
- 用沙盒資料(`gemini/personal-tools-data/`)在瀏覽器走過:改摘要時刻成錯誤順序再改回來、給任務／規則／習慣各加刪一則提醒、加到第 5 則、開關「不進摘要」後在視圖裡看到它、從視圖點項目跳到編輯欄

## 實作計畫(Gemini 先填,等主線確認)

## 回報(Gemini 填寫)
- 做了什麼(每個檔案一行):
- 沒做什麼、為什麼:
- 每個完成條件怎麼驗證的:
- 最可能出錯的地方:
- 疑問:
