# Backlog

還沒做的事,以及已知但暫時接受的問題。

**這份是清單,不是規格。** 動手做某一項之前,先把它的規則寫進 `.claude/rules/tasks.md` 或對應的 `docs/tasks/` 檔,再實作;決策理由寫進 `docs/tasks/decisions.md`。

`.claude/rules/tasks.md` 只保留「之後才做」的項目名稱,細節在這裡。

## 開發順序

1. 通知:卡 4 UI(§6j「提醒」;卡 2 摘要與卡 3 提醒後端已完成)
2. 習慣:完成一定的量、指定星期幾(§6j),接著回顧視圖與格子圖(H3)
3. 垃圾桶與子任務(§6g、§6h),一併修「已知問題」裡刪除父任務的 500
4. 自訂清單與右欄的分類指派(§6i;需要 `list` 表與 `task.listId`)、標籤(多對多,牽動左欄篩選與分組)、目標(§6e)
5. 排程視圖 C1–C3(§6c)

各項的備註見下表「之後才做的功能」。

## 之後才做的功能

| 項目 | 備註 |
|---|---|
| 自訂清單、清單資料夾、歸檔、收集箱 | 規則已定,見 `docs/tasks/decisions.md` §6i |
| 清單內自訂分組、看板檢視、任務模板 | §6i 列為之後 |
| 標籤 | 多對多(`tag` 表 + 關聯表),外加標籤管理介面與左欄篩選視圖;依標籤分組的重複呈現問題待決 |
| 目標(goal) | 規則見 `docs/tasks/decisions.md` §6e;第一階段只做新增 / 列出 / 編輯 / 改狀態 |
| 子任務 UI | 規則已定,見 `docs/tasks/decisions.md` §6g;先只有一層(`MAX_SUBTASK_DEPTH = 1`) |
| 垃圾桶(任務軟刪除)與已完成清單 | `docs/tasks/decisions.md` §6h;要動 schema(`task.deletedAt`),宜在子任務之前或同時做 |
| 清單動態 | 衍生檢視,不開事件表(§6h);等自訂清單做完 |
| 習慣的回顧視圖與格子圖(H3) | |
| 習慣:指定星期幾、完成一定的量 | §6j;量與指定星期幾宜在 H3 之前做 |
| 通知:三則摘要與個別提醒 | §6j「提醒」(含 2026-11-22 補、改的規則)。runner(`done/notify-runner.md`)與 tasks 後端(卡 2 摘要與設定 API、卡 3 `task_reminder` 表／`excludeFromSummary`／高優先組／任務與習慣提醒計算／提醒 CRUD API)已完成;卡 4 UI(`view=reminders`、右欄提醒編輯器、錯誤代碼中文)待做 |
| 習慣:每 N 天、打卡心得、分段、目標天數 | §6j 列為之後 |
| 排程視圖(C1–C3) | `docs/tasks/decisions.md` §6c |
| 批量選取與批量刪除任務 | 下一階段的 UI |
| 積分系統、Google Calendar 單向推送 | MVP 明確排除;提出前先問(平台層級不做的事見 `docs/platform/backlog.md`) |

## 已知問題

| 問題 | 回頭點 |
|---|---|
| 初次載入失敗與寫入失敗顯示在同一個位置(新增列下方),看不出是哪一種來源 | 與錯誤訊息的位置一起檢討 |
| `task.parentTaskId` 的外鍵沒有指定 `onDelete`,且連線開啟 `foreign_keys = ON`,刪除有子任務的父任務會失敗(500) | 刪除行為已定(§6g、§6h:子任務隨母任務進垃圾桶);實作垃圾桶時修 |
| 觸控裝置沒有 hover,checklist 的刪除鈕不會出現 | 手機開始使用時 |
| 色盲使用者無法區分任務列的優先級顏色(純顏色,無形狀差異) | 個人工具,刻意接受;這套元件若進共用設計系統再處理 |

## 延後事項

原 `docs/tasks/decisions.md` §8。

| 項目 | 回頭點 |
|---|---|
| 載入字型檔 | 手機或 Windows 筆電常用時,與共用設計系統一起 |
| Google Calendar 單向推送(Task → GCal) | task manager 功能穩定後 |
| `NotFoundError` 帶資源類型(`ValidationError` / `NotFoundError` 搬到 `src/modules/tasks/server/errors.ts` 已在 R1 完成) | 有第二個工具的 server 模組時 |
| 虛擬實例可操作(寫入 EXDATE 式的例外紀錄) | 做日曆視圖時 |
| 規則加時間欄位(`dueTime`、`scheduledAt`、duration 的對應),實例從規則複製 | 做日曆視圖時 |
| `createRuleFromTask` 對有 `scheduledAt` 的任務目前拒絕;改成平移或由規則決定時刻 | 做日曆視圖時 |
| 改規則時,新規則在今天剛好有一次而舊規則沒有,今天不補 | 實際遇到時 |
| `createRuleFromTask` 時 `daysBefore > 6` 的相對提醒留在原任務,這條沒有測試(卡 3 審查) | 下次動 `createRuleFromTask` 時補 |
| 前端 `PRIORITY_LEVELS` / `PRIORITY_OPTIONS` 與伺服器 `PRIORITY_VALUES` 共用一份值域(放 `src/modules/tasks/lib/`,伺服器 import) | 值域要改時 |
| 今天與未來七天要不要顯示區間內已完成的任務 | 分組已完成,這一項還沒決定 |
| 區塊標題可收合 | 收合狀態存哪裡要先決定 |
| 依清單、依標籤分組 | 自訂清單與標籤做完後,加進 `GROUP_BY_VALUES` |
| 重複任務的置頂跟著規則(`task_recurrence_rule.pinned`) | 實際用起來覺得怪時 |
| 批次貼上超過 100 行時給提示 | 實際遇到時 |
| 選單錨定在觸發它的控制項旁邊(需要邊緣偵測,可能引入定位函式庫) | 之後 |
| 一週的起始日做成使用者設定 | 之後 |
| 回顧變慢時物化週期結論(可由 log 與目標歷史重建) | 效能不足時 |
| 用點數購買凍結,走 `streakOf` 的 `exempt` 參數 | 接積分系統時 |
| 超額的顯示形式 | H2 |
| 恢復當天所屬的週期被 pause 跳過,當天完成不計入 streak | 實際用起來覺得怪時 |
| 習慣的排序(`sortOrder` 已在 schema,UI 未做拖曳) | 習慣數量變多時 |
| 紀錄型習慣在中欄沒有入口,只能在習慣視圖記錄 | 實際用起來不方便時 |
| 習慣的右欄設計 | 下一階段的 UI |
| 習慣在左欄與其他視圖的視覺區隔 | 下一階段的 UI |
| 一般任務右欄的介面整理 | 下一階段的 UI |
| 英文介面(i18n) | 越晚做,要抽出的中文字串越多 |
| 排程的月視圖 | 週視圖做完後再評估 |
| 今天的視圖要不要提示「昨天排了沒做」的排程 | 排程做完後 |
| 重複實例的排程(規則加時間欄位、實例複製) | 排程做完後 |
