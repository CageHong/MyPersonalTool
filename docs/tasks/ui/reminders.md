# UI:提醒

提醒視圖(`?view=reminders`)與各項目右欄的提醒編輯器。決策理由見 `docs/tasks/decisions.md` §6j。

## 提醒視圖(`?view=reminders`)

入口放在左欄(`CategoryColumn`)底部、今日日期上方。切換後中欄與右欄整組換成 `RemindersView`,分三區:

1. **每日摘要**:三則摘要(`morning` 早上總覽、`afternoon` 習慣進度、`evening` 晚上收尾)各自的時刻(`HH:MM`)與開關(`aria-pressed`)。改了就存;若時刻不滿足「早 < 下午 < 晚」,畫面顯示「順序不對,還沒儲存」且不送請求,改回正確順序後自動整份 `PUT /api/tasks/notification-settings` 並重抓。
2. **接下來會送的提醒**:由 `GET /api/tasks/upcoming-notifications` 取得未來 24 小時內會送出的摘要與個別提醒,顯示時刻(今天 / 明天)與標題。點任務或習慣跳到它的編輯欄(`?view=open&task=ID` 或 `?view=habits&habit=ID`);重複規則尚未產生實例的提醒(`taskId` 為 null)點選時跳到該規則最早的未完成實例(`earliestIncomplete`)。
3. **不進摘要的項目**:列出 `excludeFromSummary` 為 true 的一般任務、進行中的重複規則(`GET /api/tasks/recurrence-rules`)與習慣。點選跳到對應項目的編輯欄(重複規則跳到最早的未完成實例)。

## 右欄提醒編輯器與「不進摘要」

`TaskDetail` 與 `HabitDetail` 共用 `ReminderEditor`:

- **一般任務**:可新增相對提醒(到期日當天或提前 1..28 天的 `HH:MM`)或絕對提醒(指定日期 `YYYY-MM-DD` 與 `HH:MM`)。
- **重複任務實例**:編輯的是**重複規則**的提醒(`ruleId`),只能設相對提醒(當天或提前 1..6 天的 `HH:MM`)。
- **習慣**:編輯習慣的提醒(`habitId`),為每天 `HH:MM`。
- 每個項目上限 5 則(`MAX_REMINDERS`),滿 5 則時不顯示新增表單並提示已達上限。
- **每日摘要開關**:點選即存(`aria-pressed`)。一般任務與習慣更新各自的 `excludeFromSummary`;重複任務實例的開關改的是**重複規則**(`PATCH /api/tasks/recurrence-rules/:ruleId`)。
- 所有寫入皆經過佇列、成功後重抓、期間不停用控制項、不做樂觀更新。
