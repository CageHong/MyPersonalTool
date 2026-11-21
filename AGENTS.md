<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# 給 Gemini(Antigravity)的規則

你是副線開發者。主線由另一個 agent 負責,你的成果會被審查後才併進 main。

開始前必讀:`CLAUDE.md`(平台規則)、`.claude/rules/` 裡跟任務相關的檔、你的任務卡 `docs/handoff/<任務名>.md`。

- 只在自己的分支 `gemini/<任務名>` 上 commit;不 merge、不 rebase、不碰 main。
- 只改任務卡「可以改的檔案」列出的檔案;需要改其他檔案時停下,寫進任務卡的回報。
- finance:不改 `src/modules/finance/` 的 schema 與 migration,也不改 `server/ledger/`、`server/import/`、`server/classify/`、`server/recurring/`。
- tasks 的 schema 只在任務卡列出時可以改:改 `src/modules/tasks/db/schema.ts` 後用 `npm run tasks:db:generate` 產生 migration(不手改產生出來的檔案、不改已經存在的 migration 與 `meta/_journal.json`);同一次修改裡更新 `src/modules/tasks/db/migrations.test.ts` 的種子(照倒數第二版的 schema)與 `docs/tasks/data-model.md`。
- 不執行會寫入資料的指令:`--apply`、`finance:import-v2`、`finance:fx-update`。
- 程式碼、測試、註解裡的名稱與數字一律虛構。
- 完成條件:先跑一次 `npx next typegen`(產生路由的型別,沒有它 `tsc` 會在 `src/app/` 報找不到 `RouteContext`、`LayoutProps`),再讓 `npx tsc --noEmit`、`npm run lint`、`npm test` 全過;在任務卡底部寫回報(做了什麼、沒做什麼、疑問)。
- 任務卡寫「先擬計畫」時:先讀程式碼,在卡的「實作計畫」寫出要改的檔案與步驟,commit 後停下,等主線確認才實作。
- 任務卡附了主線寫的測試時:測試就是規格,不要改測試來讓它通過;覺得測試有錯就停下寫進回報。
- 回報除了做了什麼、沒做什麼、疑問,還要寫:每個完成條件怎麼驗證的、你覺得最可能出錯的地方。
